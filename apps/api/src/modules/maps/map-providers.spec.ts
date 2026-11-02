import { DevOsmMapProvider, MapboxMapProvider } from './map-providers';

describe('map providers', () => {
  it('the development provider describes OpenStreetMap tiles, says it is development-only, and carries no token', () => {
    const c = new DevOsmMapProvider({ MAP_DEV_TILE_URL: 'https://tiles.example.test/{z}/{x}/{y}.png' }).config();
    expect(c).toMatchObject({ provider: 'dev-osm', devOnly: true, tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'], accessToken: null });
    expect(c.attribution).toMatch(/OpenStreetMap/);
    expect(c.notice).toMatch(/not for production/i);
    expect(c.styles).toEqual({ streets: null, satellite: null }); // no satellite layer without Mapbox: the UI must say so, not fake it
  });

  it('the Mapbox provider hands out its PUBLIC token and the style URLs, and is not marked development-only', () => {
    const c = new MapboxMapProvider({ MAPBOX_PUBLIC_TOKEN: 'pk.example' }).config();
    expect(c).toMatchObject({ provider: 'mapbox', devOnly: false, accessToken: 'pk.example', tiles: null, notice: null });
    expect(c.styles.streets).toMatch(/^mapbox:\/\/styles\//);
    expect(c.styles.satellite).toMatch(/^mapbox:\/\/styles\//);
  });
});
