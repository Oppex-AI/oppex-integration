package dev.oppex.sdk.examples.spring;

import dev.oppex.sdk.api.IncidentClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OppexConfiguration {
    @Bean(destroyMethod = "close")
    public IncidentClient incidentClient(@Value("${oppex.api-key}") String apiKey,
            @Value("${oppex.service-key}") String serviceKey,
            @Value("${oppex.tenant}") String tenant) {
        return IncidentClient.builder()
                .apiKey(apiKey)
                .serviceKey(serviceKey)
                .tenant(tenant)
                .build();
    }
}

