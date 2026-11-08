import type { ImageSubject } from '@/components/ImageSlot';

/** Invented people for the gallery. None of them is a real performer. */
const PERSON_NAMES: readonly string[] = [
  'Marlo Quint',
  'The Brass Cartographer',
  'Ana-Lucía Reyes',
  'Zé',
  'Dovie Calloway',
  'Ines Varga',
  'Tobiah Rusk',
  'Wren Okafor-Dale',
  'Sable Whitlock',
  'Juniper Haldane',
  'Corvin Ashby',
  'El Faro Azul',
  'Priya Lanthorne',
  'Mags Ferrante',
  'Otto Krell',
  'Lucan Mbeki-Shore',
  'Rosalind Tamsin',
  'Hollis Greaves',
  'Kiri Tamatea',
  'Bastian Volk',
  'The Velvet Anvil',
  'Dagny Thorsen',
  'Felix Abernathy-Coe',
  'Mireille Dufresne',
];

export const galleryPeople: readonly ImageSubject[] = PERSON_NAMES.map((name, index) => ({
  kind: 'person',
  id: `per_${String(index + 1).padStart(6, '0')}`,
  name,
}));

export const galleryBelts: readonly ImageSubject[] = [
  {
    kind: 'title',
    id: 'tit_000001',
    name: 'Coastal Crown Championship',
    shortName: 'Coastal Crown',
    tier: 'gold',
  },
  {
    kind: 'title',
    id: 'tit_000002',
    name: 'Northern Heritage Title',
    shortName: 'Heritage',
    tier: 'gold',
  },
  {
    kind: 'title',
    id: 'tit_000003',
    name: 'Iron Bell Television Title',
    shortName: 'Iron Bell',
    tier: 'silver',
  },
  {
    kind: 'title',
    id: 'tit_000004',
    name: 'Twin Rivers Tag Team Titles',
    shortName: 'Twin Rivers',
    tier: 'silver',
  },
  { kind: 'title', id: 'tit_000005', name: 'Midnight Circuit Title', tier: 'bronze' },
  {
    kind: 'title',
    id: 'tit_000006',
    name: 'Rookie Ladder Trophy',
    shortName: 'Rookie Ladder',
    tier: 'bronze',
  },
  { kind: 'title', id: 'tit_000007', name: 'Open Weight Cup', tier: 'plain' },
  { kind: 'title', id: 'tit_000008', name: "Founders' Shield", tier: 'plain' },
];

/** Invented promotions, brands, events and networks. */
export const galleryLogos: readonly ImageSubject[] = [
  { kind: 'promotion', id: 'pro_000001', name: 'Harbour Lights Wrestling', shortName: 'HLW' },
  { kind: 'promotion', id: 'pro_000002', name: 'Pacific Coast Grappling', shortName: 'PCG' },
  { kind: 'promotion', id: 'pro_000003', name: 'Iron Valley Pro' },
  { kind: 'promotion', id: 'pro_000004', name: 'Grand Meridian Alliance', shortName: 'GMA' },
  { kind: 'brand', id: 'brd_000001', name: 'Friday Riot' },
  { kind: 'brand', id: 'brd_000002', name: 'Undercard Live', shortName: 'UCL' },
  { kind: 'event', id: 'evt_000001', name: 'Night of Lanterns' },
  { kind: 'event', id: 'evt_000002', name: 'Summer Collision', shortName: 'Collision' },
  { kind: 'network', id: 'net_000001', name: 'Ringline TV', shortName: 'RTV' },
  { kind: 'network', id: 'net_000002', name: 'Northwind Sports Network', shortName: 'NWS' },
];

export const galleryVenues: readonly ImageSubject[] = [
  { kind: 'venue', id: 'ven_000001', name: 'Dockside Hall' },
  { kind: 'venue', id: 'ven_000002', name: 'Copperfield Arena' },
];
