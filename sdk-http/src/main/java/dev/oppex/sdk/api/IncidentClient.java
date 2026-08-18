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
    private final String tenant;
    private final InternalMetrics metrics;
    private final HttpExecutor httpExecutor;
    private final RetryExecutor retryExecutor;
    private final AsyncDispatcher asyncDispatcher;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final ReentrantReadWriteLock lifecycleLock = new ReentrantReadWriteLock(true);

    /** Prefer {@link #builder()} for readability and future source compatibility. */
    public IncidentClient(String apiKey, String serviceKey, String tenant) {
        this(apiKey, serviceKey, tenant, DEFAULT_ENDPOINT);
    }

    IncidentClient(String apiKey, String serviceKey, String tenant, String endpoint) {
        requireNonBlank(apiKey, "apiKey");
        requireNonBlank(serviceKey, "serviceKey");
        requireNonBlank(tenant, "tenant");
        requireNonBlank(endpoint, "endpoint");
        this.serviceKey = serviceKey;
        this.tenant = tenant;
        this.metrics = new InternalMetrics();
        this.httpExecutor = new HttpExecutor(apiKey, endpoint);
        this.retryExecutor = new RetryExecutor(metrics);
        this.asyncDispatcher = new AsyncDispatcher(metrics);
    }

    IncidentClient(String serviceKey, String tenant, InternalMetrics metrics, HttpExecutor httpExecutor,
            RetryExecutor retryExecutor, AsyncDispatcher asyncDispatcher) {
        this.serviceKey = serviceKey;
        this.tenant = tenant;
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
        lifecycleLock.readLock().lock();
        try {
            ensureOpen();
            return deliver(request);
        } finally {
            lifecycleLock.readLock().unlock();
        }
    }

    /** Enqueues a best-effort delivery and returns immediately. */
    public void postAsync(final IncidentRequest request) {
        requireRequest(request);
        ensureOpenUnchecked();
        asyncDispatcher.submit(new Runnable() {
            public void run() {
                try {
                    deliver(request);
                } catch (IncidentException failure) {
                    LOGGER.log(Level.FINE, "Asynchronous incident delivery failed: {0}", failure.getMessage());
                }
            }
        });
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

    private IncidentResponse deliver(final IncidentRequest request) throws IncidentException {
        try {
            IncidentResponse response = retryExecutor.execute(new RetryExecutor.Operation<IncidentResponse>() {
                public IncidentResponse execute() throws IOException, IncidentException {
                    return httpExecutor.execute(request, serviceKey, tenant);
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

    private static void requireRequest(IncidentRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request must not be null");
        }
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
