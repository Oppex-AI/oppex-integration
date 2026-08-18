package dev.oppex.sdk.internal.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import dev.oppex.sdk.exception.IncidentException;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.IncidentResponse;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.Charset;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class HttpExecutorTest {
    private static final Charset UTF_8 = Charset.forName("UTF-8");

    private HttpServer server;
    private String endpoint;

    @Before
    public void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1/incident/post";
    }

    @After
    public void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    public void postsJsonWithApiKeyAndParsesResponse() throws Exception {
        final AtomicReference<String> apiKey = new AtomicReference<String>();
        final AtomicReference<String> requestBody = new AtomicReference<String>();
        server.createContext("/api/v1/incident/post", new HttpHandler() {
            public void handle(HttpExchange exchange) throws IOException {
                apiKey.set(exchange.getRequestHeaders().getFirst("X-API-KEY"));
                requestBody.set(read(exchange.getRequestBody()));
                respond(exchange, 200,
                        "{\"success\":true,\"code\":200,\"message\":\"created\",\"data\":\"inc-1\"}");
            }
        });
        server.start();
        HttpExecutor executor = new HttpExecutor("secret", endpoint);
        try {
            IncidentResponse response = executor.execute(request(), "service-key", "tenant");
            assertTrue(response.isSuccessful());
            assertEquals("inc-1", response.getIncidentId());
            assertEquals("secret", apiKey.get());
            assertTrue(requestBody.get().contains("\"serviceKey\":\"service-key\""));
        } finally {
            executor.close();
        }
    }

    @Test
    public void marksConfiguredStatusAsRetryable() throws Exception {
        server.createContext("/api/v1/incident/post", fixedResponse(503, "{\"message\":\"busy\"}"));
        server.start();
        HttpExecutor executor = new HttpExecutor("secret", endpoint);
        try {
            executor.execute(request(), "service-key", "tenant");
            fail("Expected IncidentException");
        } catch (IncidentException expected) {
            assertEquals(503, expected.getStatusCode());
            assertTrue(expected.isRetryable());
            assertTrue(expected.getMessage().contains("busy"));
        } finally {
            executor.close();
        }
    }

    @Test
    public void doesNotRetryClientErrorStatus() throws Exception {
        server.createContext("/api/v1/incident/post", fixedResponse(422, "{\"message\":\"invalid\"}"));
        server.start();
        HttpExecutor executor = new HttpExecutor("secret", endpoint);
        try {
            executor.execute(request(), "service-key", "tenant");
            fail("Expected IncidentException");
        } catch (IncidentException expected) {
            assertEquals(422, expected.getStatusCode());
            assertTrue(!expected.isRetryable());
        } finally {
            executor.close();
        }
    }

    private static IncidentRequest request() {
        return IncidentRequest.builder().title("Failure").source("Test").severity(2).build();
    }

    private static HttpHandler fixedResponse(final int status, final String body) {
        return new HttpHandler() {
            public void handle(HttpExchange exchange) throws IOException {
                respond(exchange, status, body);
            }
        };
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private static String read(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[256];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toString("UTF-8");
    }
}
