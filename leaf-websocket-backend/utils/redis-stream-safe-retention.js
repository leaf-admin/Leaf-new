function normalizeStreamGroup(rawGroup) {
    if (Array.isArray(rawGroup)) {
        const normalized = {};
        for (let index = 0; index < rawGroup.length; index += 2) {
            normalized[String(rawGroup[index])] = rawGroup[index + 1];
        }
        return normalized;
    }
    return rawGroup && typeof rawGroup === 'object' ? rawGroup : {};
}

function normalizeStreamId(value) {
    const normalized = String(value || '').trim();
    return /^\d+-\d+$/.test(normalized) ? normalized : null;
}

function compareStreamIds(left, right) {
    const [leftMs, leftSeq] = String(left).split('-').map((value) => BigInt(value));
    const [rightMs, rightSeq] = String(right).split('-').map((value) => BigInt(value));
    if (leftMs !== rightMs) return leftMs < rightMs ? -1 : 1;
    if (leftSeq !== rightSeq) return leftSeq < rightSeq ? -1 : 1;
    return 0;
}

async function trimRedisStreamSafely(redis, streamName, trimThreshold) {
    const currentLength = Number(await redis.xlen(streamName));
    if (!Number.isFinite(currentLength) || currentLength <= trimThreshold) {
        return { checked: true, trimmed: 0, currentLength, reason: 'below_threshold' };
    }

    const rawGroups = await redis.xinfo('GROUPS', streamName);
    if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
        return { checked: true, trimmed: 0, currentLength, reason: 'no_consumer_group' };
    }

    let safeBoundary = null;
    for (const rawGroup of rawGroups) {
        const group = normalizeStreamGroup(rawGroup);
        const groupName = String(group.name || '').trim();
        const lastDeliveredId = normalizeStreamId(
            group['last-delivered-id'] || group.lastDeliveredId
        );
        if (!groupName || !lastDeliveredId) {
            return { checked: true, trimmed: 0, currentLength, reason: 'group_state_inconclusive' };
        }

        const pendingSummary = await redis.xpending(streamName, groupName);
        const pendingCount = Number(Array.isArray(pendingSummary) ? pendingSummary[0] : NaN);
        if (!Number.isFinite(pendingCount) || pendingCount < 0) {
            return { checked: true, trimmed: 0, currentLength, reason: 'pending_state_inconclusive' };
        }

        const groupBoundary = pendingCount > 0
            ? normalizeStreamId(pendingSummary[1])
            : lastDeliveredId;
        if (!groupBoundary || groupBoundary === '0-0') {
            return { checked: true, trimmed: 0, currentLength, reason: 'unread_or_pending_boundary' };
        }
        if (!safeBoundary || compareStreamIds(groupBoundary, safeBoundary) < 0) {
            safeBoundary = groupBoundary;
        }
    }

    const trimmed = Number(await redis.xtrim(streamName, 'MINID', '~', safeBoundary)) || 0;
    return {
        checked: true,
        trimmed,
        currentLength,
        safeBoundary,
        reason: trimmed > 0 ? 'safe_boundary_trimmed' : 'nothing_older_than_safe_boundary'
    };
}

module.exports = {
    compareStreamIds,
    normalizeStreamGroup,
    trimRedisStreamSafely
};
