package dev.oppex.sdk.model;

/**
 * An immutable incident submission. Instances are created with {@link #builder()}.
 * A request may override the service key and tenant configured on the client.
 */
public final class IncidentRequest {
    private static final int MAX_SOURCE_LENGTH = 255;

    private final String serviceKey;
    private final String title;
    private final String source;
    private final Severity severity;
    private final int priority;
    private final long srcTimestamp;
    private final String tenant;
    private final String component;
    private final String group;
    private final String type;
    private final String details;

    private IncidentRequest(Builder builder, Severity validatedSeverity, long validatedTimestamp) {
        this.serviceKey = builder.serviceKey;
        this.title = builder.title;
        this.source = builder.source;
        this.severity = validatedSeverity;
        this.priority = builder.priority;
        this.srcTimestamp = validatedTimestamp;
        this.tenant = builder.tenant;
        this.component = builder.component;
        this.group = builder.group;
        this.type = builder.type;
        this.details = builder.details;
    }

    public static Builder builder() {
        return new Builder();
    }

    public String getServiceKey() {
        return serviceKey;
    }

    public String getTitle() {
        return title;
    }

    public String getSource() {
        return source;
    }

    public Severity getSeverity() {
        return severity;
    }

    public int getPriority() {
        return priority;
    }

    public long getSrcTimestamp() {
        return srcTimestamp;
    }

    public String getTenant() {
        return tenant;
    }

    public String getComponent() {
        return component;
    }

    public String getGroup() {
        return group;
    }

    public String getType() {
        return type;
    }

    /** Returns the JSON text sent in the wire-level {@code detailsJSON} field. */
    public String getDetails() {
        return details;
    }

    /** Mutable builder that creates validated, immutable requests. */
    public static final class Builder {
        private String serviceKey;
        private String title;
        private String source;
        private Severity severity;
        private Integer severityValue;
        private int priority = 1;
        private Long srcTimestamp;
        private String tenant;
        private String component;
        private String group;
        private String type;
        private String details;

        private Builder() {
        }

        public Builder serviceKey(String serviceKey) {
            this.serviceKey = serviceKey;
            return this;
        }

        public Builder title(String title) {
            this.title = title;
            return this;
        }

        public Builder source(String source) {
            this.source = source;
            return this;
        }

        public Builder severity(Severity severity) {
            this.severity = severity;
            this.severityValue = null;
            return this;
        }

        /** Sets severity using the Oppex numeric scale from 1 through 5. */
        public Builder severity(int severity) {
            this.severityValue = Integer.valueOf(severity);
            this.severity = null;
            return this;
        }

        public Builder priority(int priority) {
            this.priority = priority;
            return this;
        }

        public Builder srcTimestamp(long srcTimestamp) {
            this.srcTimestamp = Long.valueOf(srcTimestamp);
            return this;
        }

        public Builder tenant(String tenant) {
            this.tenant = tenant;
            return this;
        }

        public Builder component(String component) {
            this.component = component;
            return this;
        }

        public Builder group(String group) {
            this.group = group;
            return this;
        }

        public Builder type(String type) {
            this.type = type;
            return this;
        }

        /** Sets JSON text to send in the {@code detailsJSON} field. */
        public Builder details(String details) {
            this.details = details;
            return this;
        }

        public IncidentRequest build() {
            requireNonBlank(title, "title");
            requireNonBlank(source, "source");
            if (source.length() > MAX_SOURCE_LENGTH) {
                throw new IllegalArgumentException("source must not exceed 255 characters");
            }
            validateOptional(serviceKey, "serviceKey");
            validateOptional(tenant, "tenant");
            validateOptional(component, "component");
            validateOptional(group, "group");
            validateOptional(type, "type");
            validateOptional(details, "details");
            if (priority < 1 || priority > 5) {
                throw new IllegalArgumentException("priority must be between 1 and 5");
            }

            Severity validatedSeverity = severity;
            if (severityValue != null) {
                validatedSeverity = Severity.fromValue(severityValue.intValue());
            }
            if (validatedSeverity == null) {
                throw new IllegalArgumentException("severity must not be null");
            }

            long validatedTimestamp = srcTimestamp == null ? System.currentTimeMillis() : srcTimestamp.longValue();
            if (validatedTimestamp <= 0L) {
                throw new IllegalArgumentException("srcTimestamp must be greater than zero");
            }
            return new IncidentRequest(this, validatedSeverity, validatedTimestamp);
        }

        private static void requireNonBlank(String value, String name) {
            if (value == null) {
                throw new IllegalArgumentException(name + " must not be null");
            }
            if (value.trim().length() == 0) {
                throw new IllegalArgumentException(name + " must not be blank");
            }
        }

        private static void validateOptional(String value, String name) {
            if (value != null && value.trim().length() == 0) {
                throw new IllegalArgumentException(name + " must not be blank");
            }
        }
    }
}

