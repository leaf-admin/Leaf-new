import React from 'react';
import { AppState, Image, Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import useCampaignAssetOverride, { selectCampaignWithAsset, campaignAssetIsInWindow } from '../src/hooks/useCampaignAssetOverride';
import { loadCachedEligibleCampaigns, refreshEligibleCampaigns, recordCampaignEvent } from '../src/services/runtime/campaignCenterService';

jest.mock('../src/services/runtime/campaignCenterService', () => ({
  loadCachedEligibleCampaigns: jest.fn(), refreshEligibleCampaigns: jest.fn(), recordCampaignEvent: jest.fn(),
}));
const pumpkin = { id: 'halloween', content: { assetKey: 'halloween_pumpkin' } };
function Harness(props) {
  const asset = useCampaignAssetOverride({ surface: 'ride_map', placement: 'vehicle_marker', userId: 'driver-one', ...props });
  return <Text testID="asset-state">{JSON.stringify(asset)}</Text>;
}
const state = screen => JSON.parse(screen.getByTestId('asset-state').props.children);

describe('Campaign vehicle marker overrides', () => {
  let foreground;
  beforeEach(() => {
    jest.clearAllMocks();
    global.__LEAF_CAMPAIGN_FIXTURES__ = [];
    loadCachedEligibleCampaigns.mockResolvedValue({ campaigns: [], stale: false });
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [pumpkin] });
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      foreground = listener;
      return { remove: jest.fn() };
    });
  });
  afterEach(() => {
    delete global.__LEAF_CAMPAIGN_FIXTURES__;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('selects a supported shape without an uploaded image and skips unknown shapes', () => {
    expect(selectCampaignWithAsset([{ id: 'unknown', content: { assetKey: 'unsupported' } }, pumpkin])).toEqual(pumpkin);
    expect(selectCampaignWithAsset([])).toBeNull();
  });
  it('uses the built-in vector without a network image and tracks it once', async () => {
    const screen = render(<Harness role="driver" />);
    await waitFor(() => expect(state(screen).shapeKey).toBe('halloween_pumpkin'));
    expect(Image.prefetch).not.toHaveBeenCalled();
    expect(recordCampaignEvent).toHaveBeenCalledTimes(1);
    expect(recordCampaignEvent).toHaveBeenCalledWith('impression', pumpkin, expect.any(Object), expect.objectContaining({ assetKey: 'halloween_pumpkin' }));
    screen.rerender(<Harness role="driver" />);
    expect(recordCampaignEvent).toHaveBeenCalledTimes(1);
  });
  it('does not allow a late cached response to overwrite the fresh backend result', async () => {
    let resolveCache;
    loadCachedEligibleCampaigns.mockReturnValue(new Promise(resolve => { resolveCache = resolve; }));
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [] });
    const screen = render(<Harness />);
    await waitFor(() => expect(state(screen).hydrated).toBe(true));
    await act(async () => resolveCache({ stale: false, campaigns: [pumpkin] }));
    expect(state(screen).campaign).toBeNull();
  });
  it('drops the previous account asset immediately when identity or role changes', async () => {
    const screen = render(<Harness role="driver" />);
    await waitFor(() => expect(state(screen).shapeKey).toBe('halloween_pumpkin'));
    refreshEligibleCampaigns.mockReturnValue(new Promise(() => {}));
    screen.rerender(<Harness userId="passenger-two" role="customer" />);
    expect(state(screen).shapeKey).toBe('');
    expect(state(screen).campaign).toBeNull();
  });
  it('ignores an older in-flight response after a newer foreground refresh disables the campaign', async () => {
    let resolveOlder;
    refreshEligibleCampaigns.mockReturnValueOnce(new Promise(resolve => { resolveOlder = resolve; }));
    const screen = render(<Harness />);
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [] });
    await act(async () => foreground('active'));
    await act(async () => resolveOlder({ campaigns: [pumpkin] }));
    expect(state(screen).campaign).toBeNull();
  });
  it('does not display stale cached campaign art when the service is unreachable', async () => {
    loadCachedEligibleCampaigns.mockResolvedValue({ stale: true, campaigns: [pumpkin] });
    refreshEligibleCampaigns.mockRejectedValue(new Error('offline'));
    const screen = render(<Harness />);
    await waitFor(() => expect(state(screen).hydrated).toBe(true));
    expect(state(screen).shapeKey).toBe('');
  });
  it('returns to the default marker after campaign disable on foreground refresh', async () => {
    const screen = render(<Harness />);
    await waitFor(() => expect(state(screen).shapeKey).toBe('halloween_pumpkin'));
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [], disabled: true });
    await act(async () => foreground('active'));
    expect(state(screen).shapeKey).toBe('');
    expect(state(screen).campaign).toBeNull();
  });
  it('expires a holiday shape while the map stays mounted', async () => {
    jest.useFakeTimers();
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [{ ...pumpkin, endAt: new Date(Date.now() + 1000).toISOString() }] });
    const screen = render(<Harness />);
    await act(async () => {});
    expect(state(screen).shapeKey).toBe('halloween_pumpkin');
    act(() => jest.advanceTimersByTime(1001));
    expect(state(screen).shapeKey).toBe('');
  });
  it('waits for custom images and falls back safely when prefetch fails', async () => {
    const imageUrl = 'https://cdn.leaf.test/pumpkin.webp';
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [{ id: 'custom', content: { imageUrl } }] });
    Image.prefetch.mockRejectedValue(new Error('missing asset'));
    const screen = render(<Harness />);
    await waitFor(() => expect(state(screen).hydrated).toBe(true));
    expect(state(screen).imageUrl).toBe('');
    expect(recordCampaignEvent).not.toHaveBeenCalled();
    screen.rerender(<Harness enabled={false} />);
    expect(state(screen).shapeKey).toBe('');
  });
  it('accepts image-only creatives after prefetch, without retaining an old ready URL', async () => {
    const imageUrl = 'https://cdn.leaf.test/marker.webp';
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [{ id: 'custom', content: { imageUrl } }] });
    const screen = render(<Harness />);
    await waitFor(() => expect(state(screen).imageUrl).toBe(imageUrl));
    refreshEligibleCampaigns.mockReturnValue(new Promise(() => {}));
    screen.rerender(<Harness userId="other-user" />);
    expect(state(screen).imageUrl).toBe('');
    refreshEligibleCampaigns.mockResolvedValue({ campaigns: [{ id: 'custom-fallback', content: {
      imageUrl: 'https://cdn.leaf.test/custom-fallback.webp', assetKey: 'halloween_pumpkin',
    } }] });
    screen.rerender(<Harness userId="third-user" />);
    await waitFor(() => expect(state(screen).imageUrl).toBe('https://cdn.leaf.test/custom-fallback.webp'));
    expect(recordCampaignEvent).toHaveBeenCalledTimes(2);
  });
  it('rejects future, expired and invalid campaign windows', () => {
    const now = Date.now();
    expect(campaignAssetIsInWindow({ startAt: new Date(now + 1000).toISOString() }, now)).toBe(false);
    expect(campaignAssetIsInWindow({ endAt: new Date(now).toISOString() }, now)).toBe(false);
    expect(campaignAssetIsInWindow({ endAt: 'invalid' }, now)).toBe(false);
    expect(campaignAssetIsInWindow({}, now)).toBe(true);
  });
});
