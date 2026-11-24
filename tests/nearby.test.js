// Choosing the closest named places from a map answer (the server side of the Nearby lookup).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'nearby.ts')).href);
const at = (name, dLat, dLon, tags = {}) => ({ type: 'node', lat: 3.1 + dLat, lon: 101.6 + dLon, tags: { name, amenity: 'cafe', ...tags } });

test('places come back nearest first, with a kind and a distance rounded to 5 m', async () => {
    const { nearestPlaces } = await load();
    const result = nearestPlaces([at('Far Cafe', 0.001, 0), at('Near Cafe', 0.0002, 0), at('Mid Shop', 0.0005, 0, { amenity: undefined, shop: 'convenience' })], 3.1, 101.6);
    assert.deepEqual(result.map((p) => p.name), ['Near Cafe', 'Mid Shop', 'Far Cafe']);
    assert.equal(result[0].kind, 'cafe');
    assert.equal(result[1].kind, 'convenience');
    assert.ok(result.every((p) => p.distance % 5 === 0));
    assert.ok(result[0].distance < result[1].distance && result[1].distance < result[2].distance);
});

test('the same name mapped twice is one place (the nearer one), and the list is capped', async () => {
    const { nearestPlaces } = await load();
    const twice = nearestPlaces([at('Kopi Corner', 0.0009, 0), at('kopi corner', 0.0001, 0)], 3.1, 101.6);
    assert.equal(twice.length, 1);
    assert.ok(twice[0].distance < 30);
    const many = Array.from({ length: 30 }, (_, i) => at(`Place ${i}`, i * 0.00005, 0));
    assert.equal(nearestPlaces(many, 3.1, 101.6, 10).length, 10);
    assert.equal(nearestPlaces(many, 3.1, 101.6, 500).length, 20);
});

test('ways use their centre; things without a name or a position are skipped; names are cleaned', async () => {
    const { nearestPlaces } = await load();
    const result = nearestPlaces([
        { type: 'way', center: { lat: 3.1002, lon: 101.6 }, tags: { name: 'Mall  Name', shop: 'mall' } },
        { type: 'node', lat: 3.1, lon: 101.6, tags: { amenity: 'cafe' } },
        { type: 'node', tags: { name: 'No position', amenity: 'cafe' } },
        { type: 'node', lat: 3.1, lon: 101.6001, tags: { name: '<b>Cafe</b>', amenity: 'cafe' } },
    ], 3.1, 101.6);
    assert.deepEqual(result.map((p) => p.name).sort(), ['Mall Name', 'b Cafe /b'].sort());
    assert.ok(result.every((p) => !/[<>]/.test(p.name)));
});

test('rubbish in gives an empty list, and only real coordinates are accepted', async () => {
    const { nearestPlaces, validCoordinates } = await load();
    for (const bad of [null, undefined, 'x', {}, 5]) assert.deepEqual(nearestPlaces(bad, 3.1, 101.6), []);
    assert.equal(validCoordinates(3.1, 101.6), true);
    for (const [a, b] of [[91, 0], [0, 181], [NaN, 1], ['3', '101'], [null, null], [Infinity, 0]]) assert.equal(validCoordinates(a, b), false, `${a},${b}`);
});

const feature = (name, key, value, dLat, dLon = 0) => ({ type: 'Feature', properties: { name, osm_key: key, osm_value: value }, geometry: { type: 'Point', coordinates: [101.6 + dLon, 3.1 + dLat] } });

test('a Photon answer keeps only shops, food and amenities, nearest first, reading [lon, lat]', async () => {
    const { placesFromPhoton } = await load();
    const result = placesFromPhoton({ features: [
        feature('Mid Valley Megamall', 'shop', 'mall', 0.0006),
        feature('Centre Court', 'place', 'square', 0.0001),
        feature('KFC', 'amenity', 'fast_food', 0.0002),
        feature('Starbucks', 'amenity', 'cafe', 0.0001),
        { type: 'Feature', properties: { name: 'No point', osm_key: 'shop', osm_value: 'mall' } },
        { type: 'Feature', properties: { osm_key: 'shop', osm_value: 'mall' }, geometry: { coordinates: [101.6, 3.1] } },
    ] }, 3.1, 101.6);
    assert.deepEqual(result.map((p) => p.name), ['Starbucks', 'KFC', 'Mid Valley Megamall']);
    assert.equal(result[0].kind, 'cafe');
    assert.equal(result[1].kind, 'fast food');
    assert.ok(result[0].distance < result[1].distance);
});

test('a Photon answer that is not a list gives an empty list', async () => {
    const { placesFromPhoton } = await load();
    for (const bad of [null, undefined, 'x', {}, { features: 'x' }]) assert.deepEqual(placesFromPhoton(bad, 3.1, 101.6), []);
});

test('answers from two services are joined: one entry per name, the one with a kind wins, nearest first', async () => {
    const { mergePlaces } = await load();
    const merged = mergePlaces([
        [{ name: 'KFC', kind: 'fast food', distance: 30 }, { name: 'Watsons', kind: '', distance: 90 }],
        [{ name: 'kfc', kind: '', distance: 20 }, { name: 'Watsons', kind: 'chemist', distance: 95 }, { name: 'Starbucks', kind: 'cafe', distance: 10 }],
    ]);
    assert.deepEqual(merged.map((p) => p.name), ['Starbucks', 'KFC', 'Watsons']);
    assert.equal(merged[1].kind, 'fast food');
    assert.equal(merged[2].kind, 'chemist');
    assert.equal(mergePlaces([[], []]).length, 0);
});
