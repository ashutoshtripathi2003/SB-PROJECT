import request from 'supertest'
import { describe, expect, it } from 'vitest'

process.env.DATABASE_PATH = ':memory:'
process.env.MAPTILER_KEY = 'test-maptiler-key'

const app = (await import('../app')).createApp()

describe('map tiles', () => {
  it('website gets MapTiler, the phone app gets the keyless map', async () => {
    const web = (await request(app).get('/api/config')).body.maps
    expect(web.tiles.url).toContain('api.maptiler.com')
    const phone = (await request(app).get('/api/config').set('x-ridesync-app', '1')).body.maps
    expect(phone.tiles.url).toContain('basemaps.cartocdn.com')
    expect(phone.tiles.url).not.toContain('key=')
  })
})
