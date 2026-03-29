import { API_KEYS, WEATHER_MOODS } from '../constants';

const BASE_URL = 'https://api.openweathermap.org/data/2.5';

export async function getCurrentWeather(latitude, longitude) {
  const url = `${BASE_URL}/weather?lat=${latitude}&lon=${longitude}&appid=${API_KEYS.OPENWEATHER}&units=metric&lang=kr`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Weather fetch failed');
  const data = await response.json();
  return {
    condition: data.weather[0].main,
    description: data.weather[0].description,
    temp: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    humidity: data.main.humidity,
    city: data.name,
    mood: WEATHER_MOODS[data.weather[0].main] || WEATHER_MOODS.Clear,
  };
}

export function getWeatherEmoji(condition) {
  return WEATHER_MOODS[condition]?.emoji || '🌤️';
}

export function getWeatherMoodLabel(condition) {
  return WEATHER_MOODS[condition]?.label || '맑음';
}
