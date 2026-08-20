export interface IncidentResponse {
  readonly successful: boolean;
  readonly code: number;
  readonly message: string | null;
  readonly incidentId: string | null;
}
