import { describe, it, expect } from 'vitest';
import { storageRent, totalStorageRent, storageRentLabel } from '../../src/iso/storage-rent';
import { BUILD_COSTS_MONEY } from '../../src/iso/config';
describe('PLAY-FIX-1 carrying cost', () => {
  it('charges only overflow, with continuous progressive marginal bands', () => {
    expect(storageRent(100,100)).toBe(0);
    expect(storageRent(110,100)).toBe(2);
    expect(storageRent(125,100)).toBe(5);
    expect(storageRent(200,100)).toBe(80);
    expect(storageRent(300,100)).toBe(380);
    expect(totalStorageRent({ore:125,wood:200},100)).toBe(85);
    expect(storageRentLabel({ore:110},100)).toBe('Over cap: +10 ore · rent $2.00/min');
  });
  it('prices a 20-tile first line at $476 rather than $1206', () => {
    expect(BUILD_COSTS_MONEY.rail).toBe(5);
    expect(BUILD_COSTS_MONEY.platform).toBe(180);
    expect(BUILD_COSTS_MONEY.trainDepot).toBe(112);
    expect(BUILD_COSTS_MONEY.train).toBe(84);
    expect(20*5+180+112+84).toBe(476);
  });
});
