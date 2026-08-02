class WeatherDomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

// Thrown by a WeatherProvider that can't answer for a given (location, date)
// — a network failure, a non-OK response, or a date outside the source's
// coverage. weather-service.ts catches exactly this type to fall back to
// ProceduralWeatherProvider rather than letting the whole growth catch-up
// step fail over one missing weather day.
export class WeatherProviderUnavailableError extends WeatherDomainError {}
