const path = require('path');

const {
  objectNameFor,
  planPrune,
  selectLatestVerifiedSets
} = require('../../../scripts/ops/upload-backup-offsite.cjs');

describe('upload-backup-offsite', () => {
  const listings = {
    '/b/redis': [
      'redis-20261014_061511.rdb.gz',
      'redis-20261014_061511.rdb.gz.manifest.json',
      'redis-20261014_061511.rdb.gz.sha256',
      'redis-20261014_061511.rdb.gz.verified.json',
      // Newer but never verified: must not be shipped.
      'redis-20261015_061511.rdb.gz',
      'redis-20261015_061511.rdb.gz.sha256'
    ],
    '/b/firestore': [
      'firestore-critical-20261013_061511.json.gz',
      'firestore-critical-20261013_061511.json.gz.verified.json',
      'firestore-critical-20261015_061511.json.gz',
      'firestore-critical-20261015_061511.json.gz.manifest.json',
      'firestore-critical-20261015_061511.json.gz.verified.json'
    ]
  };
  const listDir = (dir) => listings[dir];

  it('picks the newest verified set per kind with its sidecars', () => {
    const sets = selectLatestVerifiedSets('/b', listDir);

    expect(sets).toEqual([
      {
        kind: 'redis',
        stamp: '20261014_061511',
        files: [
          'redis-20261014_061511.rdb.gz',
          'redis-20261014_061511.rdb.gz.manifest.json',
          'redis-20261014_061511.rdb.gz.sha256',
          'redis-20261014_061511.rdb.gz.verified.json'
        ].map((name) => path.join('/b/redis', name))
      },
      {
        kind: 'firestore',
        stamp: '20261015_061511',
        files: [
          'firestore-critical-20261015_061511.json.gz',
          'firestore-critical-20261015_061511.json.gz.manifest.json',
          'firestore-critical-20261015_061511.json.gz.verified.json'
        ].map((name) => path.join('/b/firestore', name))
      }
    ]);
  });

  it('fails when a kind has no verified backup', () => {
    expect(() => selectLatestVerifiedSets('/b', (dir) => (dir === '/b/redis' ? [] : listings[dir])))
      .toThrow('Nenhum backup verificado encontrado para redis');
  });

  it('groups objects by backup day under the prefix', () => {
    expect(objectNameFor('ops-backups/leaf/', '20261015_061511', '/b/redis/redis-x.rdb.gz'))
      .toBe('ops-backups/leaf/2026-10-15/redis-x.rdb.gz');
  });

  it('prunes only dated folders older than the retention window', () => {
    const names = [
      'ops-backups/leaf/2026-09-01/redis-a.rdb.gz',
      'ops-backups/leaf/2026-09-20/redis-b.rdb.gz',
      'ops-backups/leaf/notes/readme.txt',
      'other/2026-01-01/x'
    ];

    expect(planPrune(names, 'ops-backups/leaf', 30, new Date('2026-10-15T12:00:00Z')))
      .toEqual(['ops-backups/leaf/2026-09-01/redis-a.rdb.gz']);
  });
});
