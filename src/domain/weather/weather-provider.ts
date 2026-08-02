// Shared shape both weather sources produce — the growth/soil engine never
// branches on which source is active, only on this interface, per the
// repository-pattern principle (rules/common/patterns.md). See the
// architecture doc's §3 for the full design.

export interface DailyWeather {
  date: Date;
  tempHighC: number;
  tempLowC: number;
  precipitationMm: number;
  cloudCoverPct: number;
  humidityPct: number;
  windSpeedKph: number;
  condition: string;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
}

export interface WeatherProvider {
  getDay(location: WeatherLocation, date: Date): Promise<DailyWeather>;
}
