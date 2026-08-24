package dev.oppex.sdk.api;

import dev.oppex.sdk.builder.IncidentClientBuilder;
import dev.oppex.sdk.exception.IncidentException;
import dev.oppex.sdk.internal.async.AsyncDispatcher;
import dev.oppex.sdk.internal.http.HttpExecutor;
import dev.oppex.sdk.internal.metrics.InternalMetrics;
import dev.oppex.sdk.internal.retry.RetryExecutor;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.IncidentResponse;

import java.io.Closeable;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Thread-safe, reusable façade for posting incidents to Oppex.
 * Applications should normally create one instance and close it during application shutdown.
 */
public final class IncidentClient implements Closeable {
    private static final Logger LOGGER = Logger.getLogger(IncidentClient.class.getName());
    private static final String DEFAULT_ENDPOINT = "https://api.oppex.ai/api/v1/incident/post";

    private final String serviceKey;
    private final InternalMetrics metrics;
    private final HttpExecutor httpExecutor;
    private final RetryExecutor retryExecutor;
    private final AsyncDispatcher asyncDispatcher;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final ReentrantReadWriteLock lifecycleLock = new ReentrantReadWriteLock(true);

    /**
     * Creates a client without a default service key. Every incident must then either carry its own
     * service key or be posted with {@link #postWithServiceRouting(IncidentRequest)}.
     */
    public IncidentClient(String apiKey) {
        this(apiKey, null, DEFAULT_ENDPOINT);
    }

    /** Prefer {@link #builder()} for readability and future source compatibility. */
    public IncidentClient(String apiKey, String serviceKey) {
        this(apiKey, serviceKey, DEFAULT_ENDPOINT);
    }

    IncidentClient(String apiKey, String serviceKey, String endpoint) {
        requireNonBlank(apiKey, "apiKey");
        requireNonBlank(endpoint, "endpoint");
        this.serviceKey = blankToNull(serviceKey);
        this.metrics = new InternalMetrics();
        this.httpExecutor = new HttpExecutor(apiKey, endpoint);
        this.retryExecutor = new RetryExecutor(metrics);
        this.asyncDispatcher = new AsyncDispatcher(metrics);
    }

    IncidentClient(String serviceKey, InternalMetrics metrics, HttpExecutor httpExecutor,
            RetryExecutor retryExecutor, AsyncDispatcher asyncDispatcher) {
        this.serviceKey = serviceKey;
        this.metrics = metrics;
        this.httpExecutor = httpExecutor;
        this.retryExecutor = retryExecutor;
        this.asyncDispatcher = asyncDispatcher;
    }

    public static IncidentClientBuilder builder() {
        return new IncidentClientBuilder();
    }

    /** Posts on the calling thread, including any retry delays. */
    public IncidentResponse post(final IncidentRequest request) throws IncidentException {
        requireRequest(request);
        requireServiceKey(request);
        return postWithDefault(request, serviceKey);
    }

    /**
     * Posts without a service key so Oppex resolves the target service from the incident itself.
     * The request must not carry its own service key. Otherwise identical to
     * {@link #post(IncidentRequest)}: it runs and retries on the calling thread.
     */
    public IncidentResponse postWithServiceRouting(final IncidentRequest request) throws IncidentException {
        requireRequest(request);
        requireServiceRoutable(request);
        return postWithDefault(request, null);
    }

    /** Enqueues a best-effort delivery and returns immediately. */
    public void postAsync(final IncidentRequest request) {
        requireRequest(request);
        requireServiceKey(request);
        submit(request, serviceKey);
    }

    /**
     * Enqueues a best-effort service-routed delivery and returns immediately.
     * The request must not carry its own service key.
     */
    public void postAsyncWithServiceRouting(final IncidentRequest request) {
        requireRequest(request);
        requireServiceRoutable(request);
        submit(request, null);
    }

    /** Drains queued work for a bounded period and releases all owned resources. */
    public void close() {
        lifecycleLock.writeLock().lock();
        try {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            asyncDispatcher.close();
            try {
                httpExecutor.close();
            } catch (IOException failure) {
                LOGGER.log(Level.FINE, "Failed to close Oppex HTTP resources", failure);
            }
        } finally {
            lifecycleLock.writeLock().unlock();
        }
    }

    private IncidentResponse postWithDefault(final IncidentRequest request, final String defaultServiceKey)
            throws IncidentException {
        lifecycleLock.readLock().lock();
        try {
            ensureOpen();
            return deliver(request, defaultServiceKey);
        } finally {
            lifecycleLock.readLock().unlock();
        }
    }

    private void submit(final IncidentRequest request, final String defaultServiceKey) {
        ensureOpenUnchecked();
        asyncDispatcher.submit(new Runnable() {
            public void run() {
                try {
                    deliver(request, defaultServiceKey);
                } catch (IncidentException failure) {
                    LOGGER.log(Level.FINE, "Asynchronous incident delivery failed: {0}", failure.getMessage());
                }
            }
        });
    }

    private IncidentResponse deliver(final IncidentRequest request, final String defaultServiceKey)
            throws IncidentException {
        try {
            IncidentResponse response = retryExecutor.execute(new RetryExecutor.Operation<IncidentResponse>() {
                public IncidentResponse execute() throws IOException, IncidentException {
                    return httpExecutor.execute(request, defaultServiceKey);
                }
            });
            metrics.incrementSuccessful();
            return response;
        } catch (IncidentException failure) {
            metrics.incrementFailed();
            throw failure;
        } finally {
            metrics.incrementProcessed();
        }
    }

    private void ensureOpen() throws IncidentException {
        if (closed.get()) {
            throw new IncidentException("IncidentClient is closed");
        }
    }

    private void ensureOpenUnchecked() {
        if (closed.get()) {
            throw new IllegalStateException("IncidentClient is closed");
        }
    }

    /** Service routing is the only delivery mode available when no service key is configured anywhere. */
    private void requireServiceKey(IncidentRequest request) {
        if (serviceKey == null && request.getServiceKey() == null) {
            throw new IllegalStateException("No serviceKey is configured on the client or the request; "
                    + "supply one or use postWithServiceRouting");
        }
    }

    private static void requireServiceRoutable(IncidentRequest request) {
        if (request.getServiceKey() != null) {
            throw new IllegalArgumentException("request must not carry a serviceKey when service routing is used");
        }
    }

    private static void requireRequest(IncidentRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request must not be null");
        }
    }

    private static String blankToNull(String value) {
        if (value == null || value.trim().length() == 0) {
            return null;
        }
        return value;
    }

    private static void requireNonBlank(String value, String name) {
        if (value == null) {
            throw new IllegalArgumentException(name + " must not be null");
        }
        if (value.trim().length() == 0) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
