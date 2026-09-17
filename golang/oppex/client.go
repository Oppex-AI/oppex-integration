package oppex

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Config configures a [Client]. Only APIKey is required.
//
// It deliberately exposes no timeout, retry, queue, proxy or endpoint knobs: the
// delivery policy is part of the cross-language incident contract, not per-caller
// configuration.
type Config struct {
	// APIKey authenticates every request. Required, non-blank.
	APIKey string
	// ServiceKey is the default service for incidents that do not carry their
	// own. When omitted, incidents must either supply one or be posted with
	// [Client.PostWithServiceRouting].
	ServiceKey string
	// Logger receives this client's internal logging. Defaults to
	// [slog.Default].
	Logger *slog.Logger
}

// Client posts incidents to Oppex. It is safe for concurrent use; create one per
// application and close it during shutdown.
type Client struct {
	serviceKey string
	logger     *slog.Logger
	transport  *transport
	dispatcher *dispatcher
	// retryDelays is the backoff schedule. It is a field only so tests can run
	// the real retry loop without waiting out the production schedule; nothing
	// on the public surface can change it.
	retryDelays []time.Duration

	// lifecycle admits posts under a read lock and closes under the write lock,
	// so Close cannot tear the transport down while a delivery is in flight.
	lifecycle sync.RWMutex
	closed    bool
}

// New validates the configuration and returns a ready client.
func New(config Config) (*Client, error) {
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, invalidf("apiKey must not be blank")
	}

	logger := config.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		serviceKey:  strings.TrimSpace(config.ServiceKey),
		logger:      logger,
		transport:   newTransport(config.APIKey),
		dispatcher:  newDispatcher(logger, workerCount, queueCapacity),
		retryDelays: defaultRetryDelays,
	}, nil
}

// Post delivers an incident on the calling goroutine, including any retry delays.
// The request's own service key overrides the client's.
func (c *Client) Post(ctx context.Context, request IncidentRequest) (IncidentResponse, error) {
	normalized, err := c.prepare(request)
	if err != nil {
		return IncidentResponse{}, err
	}
	if normalized.ServiceKey == "" && c.serviceKey == "" {
		return IncidentResponse{}, invalidf(
			"no serviceKey is configured on the client or the request; supply one or use PostWithServiceRouting")
	}
	return c.postSynchronously(ctx, normalized, c.serviceKey)
}

// PostWithServiceRouting delivers an incident without a service key so Oppex
// resolves the target service itself. The request must not carry its own service
// key. It is otherwise identical to [Client.Post].
func (c *Client) PostWithServiceRouting(ctx context.Context, request IncidentRequest) (IncidentResponse, error) {
	normalized, err := c.prepareForServiceRouting(request)
	if err != nil {
		return IncidentResponse{}, err
	}
	return c.postSynchronously(ctx, normalized, "")
}

// PostAsync queues a best-effort delivery and returns immediately. Validation and
// the closed-client check still happen on the calling goroutine, so a malformed
// incident is reported to the caller instead of disappearing into a worker.
// A delivery failure after queueing is logged and not returned.
func (c *Client) PostAsync(request IncidentRequest) error {
	normalized, err := c.prepare(request)
	if err != nil {
		return err
	}
	if normalized.ServiceKey == "" && c.serviceKey == "" {
		return invalidf(
			"no serviceKey is configured on the client or the request; supply one or use PostAsyncWithServiceRouting")
	}
	return c.submit(normalized, c.serviceKey)
}

// PostAsyncWithServiceRouting queues a best-effort service-routed delivery. The
// request must not carry its own service key.
func (c *Client) PostAsyncWithServiceRouting(request IncidentRequest) error {
	normalized, err := c.prepareForServiceRouting(request)
	if err != nil {
		return err
	}
	return c.submit(normalized, "")
}

// Close drains queued work for up to ten seconds, then releases every owned
// resource. It is idempotent and always returns nil; the signature matches
// [io.Closer] so a client works with the usual defer idiom.
func (c *Client) Close() error {
	c.lifecycle.Lock()
	defer c.lifecycle.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	c.dispatcher.close(closeDrainTimeout)
	c.transport.close()
	return nil
}

// prepare runs the checks every post shares: the client must be open and the
// incident must be valid.
func (c *Client) prepare(request IncidentRequest) (IncidentRequest, error) {
	if c.isClosed() {
		return IncidentRequest{}, ErrClientClosed
	}
	return request.normalize()
}

func (c *Client) prepareForServiceRouting(request IncidentRequest) (IncidentRequest, error) {
	normalized, err := c.prepare(request)
	if err != nil {
		return IncidentRequest{}, err
	}
	if normalized.ServiceKey != "" {
		return IncidentRequest{}, invalidf("request must not carry a serviceKey when service routing is used")
	}
	return normalized, nil
}

func (c *Client) isClosed() bool {
	c.lifecycle.RLock()
	defer c.lifecycle.RUnlock()
	return c.closed
}

// postSynchronously delivers under the lifecycle read lock, so Close cannot tear
// the transport down underneath a caller's own goroutine.
func (c *Client) postSynchronously(ctx context.Context, request IncidentRequest, defaultServiceKey string) (IncidentResponse, error) {
	c.lifecycle.RLock()
	defer c.lifecycle.RUnlock()
	if c.closed {
		return IncidentResponse{}, ErrClientClosed
	}
	return c.deliver(ctx, request, defaultServiceKey)
}

func (c *Client) submit(request IncidentRequest, defaultServiceKey string) error {
	accepted := c.dispatcher.submit(func(ctx context.Context) {
		// No closed check here: Close drains the dispatcher before touching the
		// transport, so a task queued before Close still has a live connection
		// pool, and a task submitted after Close was already refused above. The
		// context is the dispatcher's, so a delivery still running when Close
		// gives up waiting is cancelled rather than left to finish.
		if _, err := c.deliver(ctx, request, defaultServiceKey); err != nil {
			c.logger.Debug("oppex: asynchronous incident delivery failed", slog.Any("error", err))
		}
	})
	if !accepted {
		return ErrClientClosed
	}
	return nil
}

// deliver serializes, sends and retries a single incident. The request's own
// service key wins over defaultServiceKey.
//
// It deliberately takes no lifecycle lock. Close holds the write lock while it
// drains the dispatcher, so a queued task that waited for a read lock here would
// deadlock against the very drain it is supposed to finish. Queued work instead
// relies on Close draining the dispatcher fully before the transport is closed.
func (c *Client) deliver(ctx context.Context, request IncidentRequest, defaultServiceKey string) (IncidentResponse, error) {
	serviceKey := request.ServiceKey
	if serviceKey == "" {
		serviceKey = defaultServiceKey
	}
	payload, err := serializeRequest(request, serviceKey)
	if err != nil {
		return IncidentResponse{}, err
	}

	return retry(ctx, c.retryDelays, func() (IncidentResponse, error) {
		return c.transport.send(ctx, payload)
	})
}
