package dev.oppex.sdk.internal.http;

import dev.oppex.sdk.exception.IncidentException;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.IncidentResponse;
import org.apache.http.HttpEntity;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;
import org.apache.http.util.EntityUtils;

import java.io.Closeable;
import java.io.IOException;
import java.nio.charset.Charset;
import java.util.concurrent.atomic.AtomicBoolean;

/** Internal Apache HttpClient adapter. This type is not part of the supported SDK API. */
public final class HttpExecutor implements Closeable {
    private static final Charset UTF_8 = Charset.forName("UTF-8");
    private static final int CONNECT_TIMEOUT_MILLIS = 3000;
    private static final int SOCKET_TIMEOUT_MILLIS = 5000;
    private static final int CONNECTION_REQUEST_TIMEOUT_MILLIS = 3000;

    private final String apiKey;
    private final String endpoint;
    private final PoolingHttpClientConnectionManager connectionManager;
    private final CloseableHttpClient httpClient;
    private final RequestConfig requestConfig;
    private final JsonCodec jsonCodec;
    private final AtomicBoolean closed = new AtomicBoolean();

    public HttpExecutor(String apiKey, String endpoint) {
        this.apiKey = apiKey;
        this.endpoint = endpoint;
        this.connectionManager = new PoolingHttpClientConnectionManager();
        this.connectionManager.setMaxTotal(20);
        this.connectionManager.setDefaultMaxPerRoute(20);
        this.requestConfig = RequestConfig.custom()
                .setConnectTimeout(CONNECT_TIMEOUT_MILLIS)
                .setSocketTimeout(SOCKET_TIMEOUT_MILLIS)
                .setConnectionRequestTimeout(CONNECTION_REQUEST_TIMEOUT_MILLIS)
                .build();
        this.httpClient = HttpClients.custom()
                .setConnectionManager(connectionManager)
                .disableAutomaticRetries()
                .build();
        this.jsonCodec = new JsonCodec();
    }

    public IncidentResponse execute(IncidentRequest request, String defaultServiceKey, String defaultTenant)
            throws IOException, IncidentException {
        if (closed.get()) {
            throw new IncidentException("IncidentClient is closed");
        }

        HttpPost post = new HttpPost(endpoint);
        post.setConfig(requestConfig);
        post.setHeader("Accept", "application/json");
        post.setHeader("X-API-KEY", apiKey);
        post.setEntity(new StringEntity(jsonCodec.serialize(request, defaultServiceKey, defaultTenant),
                ContentType.APPLICATION_JSON));

        CloseableHttpResponse response = httpClient.execute(post);
        try {
            int statusCode = response.getStatusLine().getStatusCode();
            HttpEntity entity = response.getEntity();
            String body = entity == null ? null : EntityUtils.toString(entity, UTF_8);
            if (statusCode >= 200 && statusCode < 300) {
                return jsonCodec.parseResponse(body, statusCode);
            }

            String message = "Oppex returned HTTP " + statusCode;
            if (body != null && body.trim().length() > 0) {
                try {
                    IncidentResponse error = jsonCodec.parseResponse(body, statusCode);
                    if (error.getMessage() != null && error.getMessage().trim().length() > 0) {
                        message = message + ": " + error.getMessage();
                    }
                } catch (IncidentException ignored) {
                    // The status code remains sufficient when an error response is not JSON.
                }
            }
            throw new IncidentException(message, statusCode, isRetryableStatus(statusCode));
        } finally {
            try {
                response.close();
            } catch (IOException ignored) {
                // The entity is already consumed; a close failure must not mask the HTTP result.
            }
        }
    }

    public void close() throws IOException {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        try {
            httpClient.close();
        } finally {
            connectionManager.shutdown();
        }
    }

    private static boolean isRetryableStatus(int statusCode) {
        return statusCode == 429 || statusCode == 500 || statusCode == 502 || statusCode == 503 || statusCode == 504;
    }
}
