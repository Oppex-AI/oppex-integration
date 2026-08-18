package dev.oppex.sdk.internal.http;

import com.fasterxml.jackson.core.JsonEncoding;
import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import dev.oppex.sdk.exception.IncidentException;
import dev.oppex.sdk.model.IncidentRequest;
import dev.oppex.sdk.model.IncidentResponse;

import java.io.ByteArrayOutputStream;
import java.io.IOException;

final class JsonCodec {
    private final JsonFactory jsonFactory = new JsonFactory();

    String serialize(IncidentRequest request, String defaultServiceKey, String defaultTenant) throws IOException {
        String serviceKey = request.getServiceKey() == null ? defaultServiceKey : request.getServiceKey();
        String tenant = request.getTenant() == null ? defaultTenant : request.getTenant();

        ByteArrayOutputStream output = new ByteArrayOutputStream(512);
        JsonGenerator json = jsonFactory.createGenerator(output, JsonEncoding.UTF8);
        try {
            json.writeStartObject();
            json.writeStringField("serviceKey", serviceKey);
            json.writeStringField("title", request.getTitle());
            json.writeStringField("source", request.getSource());
            json.writeNumberField("severity", request.getSeverity().getValue());
            json.writeNumberField("priority", request.getPriority());
            json.writeNumberField("srcTimestamp", request.getSrcTimestamp());
            json.writeStringField("tenant", tenant);
            writeOptionalString(json, "component", request.getComponent());
            writeOptionalString(json, "group", request.getGroup());
            writeOptionalString(json, "type", request.getType());
            writeOptionalString(json, "detailsJSON", request.getDetails());
            json.writeEndObject();
        } finally {
            json.close();
        }
        return output.toString("UTF-8");
    }

    IncidentResponse parseResponse(String body, int httpStatus) throws IncidentException {
        if (body == null || body.trim().length() == 0) {
            return new IncidentResponse(httpStatus >= 200 && httpStatus < 300, httpStatus, null, null);
        }

        boolean successful = httpStatus >= 200 && httpStatus < 300;
        int code = httpStatus;
        String message = null;
        String incidentId = null;
        JsonParser parser = null;
        try {
            parser = jsonFactory.createParser(body);
            if (parser.nextToken() != JsonToken.START_OBJECT) {
                throw new IncidentException("Oppex returned a malformed JSON response");
            }
            while (parser.nextToken() != JsonToken.END_OBJECT) {
                String fieldName = parser.getCurrentName();
                JsonToken valueToken = parser.nextToken();
                if ("success".equals(fieldName) && valueToken == JsonToken.VALUE_TRUE) {
                    successful = true;
                } else if ("success".equals(fieldName) && valueToken == JsonToken.VALUE_FALSE) {
                    successful = false;
                } else if ("code".equals(fieldName) && valueToken != null && valueToken.isNumeric()) {
                    code = parser.getIntValue();
                } else if ("message".equals(fieldName) && valueToken == JsonToken.VALUE_STRING) {
                    message = parser.getText();
                } else if ("data".equals(fieldName) && valueToken == JsonToken.VALUE_STRING) {
                    incidentId = parser.getText();
                } else if (valueToken == JsonToken.START_ARRAY || valueToken == JsonToken.START_OBJECT) {
                    parser.skipChildren();
                }
            }
            return new IncidentResponse(successful, code, message, incidentId);
        } catch (IOException malformed) {
            throw new IncidentException("Oppex returned a malformed JSON response", malformed);
        } finally {
            if (parser != null) {
                try {
                    parser.close();
                } catch (IOException ignored) {
                    // Parsing has completed or another parsing error is already being reported.
                }
            }
        }
    }

    private static void writeOptionalString(JsonGenerator json, String name, String value) throws IOException {
        if (value != null) {
            json.writeStringField(name, value);
        }
    }
}
