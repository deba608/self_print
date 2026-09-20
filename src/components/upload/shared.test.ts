import { describe, it, expect } from 'vitest'
import { fallbackUploadLimit, isLocalHostname, MAX_UPLOAD_BYTES, NON_LOCAL_FALLBACK_LIMIT_BYTES } from './shared'

describe('isLocalHostname', () => {
  it('accepts loopback names', () => {
    expect(isLocalHostname('localhost')).toBe(true)
    expect(isLocalHostname('127.0.0.1')).toBe(true)
    expect(isLocalHostname('::1')).toBe(true)
    expect(isLocalHostname('[::1]')).toBe(true)
  })

  it('accepts private-network IPs used for dev-testing from other devices', () => {
    expect(isLocalHostname('192.168.1.5')).toBe(true)
    expect(isLocalHostname('10.0.0.2')).toBe(true)
    expect(isLocalHostname('172.16.0.9')).toBe(true)
    expect(isLocalHostname('172.31.255.1')).toBe(true)
    expect(isLocalHostname('169.254.10.20')).toBe(true)
  })

  it('rejects public hosts and non-private 172.x ranges', () => {
    expect(isLocalHostname('example.com')).toBe(false)
    expect(isLocalHostname('my-shop.vercel.app')).toBe(false)
    expect(isLocalHostname('172.15.0.1')).toBe(false)
    expect(isLocalHostname('172.32.0.1')).toBe(false)
    expect(isLocalHostname('8.8.8.8')).toBe(false)
    expect(isLocalHostname('')).toBe(false)
  })
})

describe('fallbackUploadLimit', () => {
  it('allows the full upload limit on local hostnames', () => {
    expect(fallbackUploadLimit('localhost')).toBe(MAX_UPLOAD_BYTES)
    expect(fallbackUploadLimit('192.168.1.5')).toBe(MAX_UPLOAD_BYTES)
  })

  it('caps at the serverless body limit elsewhere', () => {
    expect(fallbackUploadLimit('my-shop.vercel.app')).toBe(NON_LOCAL_FALLBACK_LIMIT_BYTES)
    expect(fallbackUploadLimit(undefined)).toBe(NON_LOCAL_FALLBACK_LIMIT_BYTES)
  })
})
