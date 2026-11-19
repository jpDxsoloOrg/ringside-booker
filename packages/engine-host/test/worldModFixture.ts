/**
 * Builds a small, entirely fictional workshop world mod database in memory (sql.js), with the
 * same tables and column names as the real format, and reads it back the way the game's C# reader
 * does: every row of every table as a column-name-to-value object.
 *
 * Nothing here comes from a real mod. Every name is invented.
 */

import initSqlJs from 'sql.js';
import type { Database, SqlValue } from 'sql.js';

const SCHEMA = `
CREATE TABLE gameworld (worldName TEXT(100), startDate TEXT(10), currentDate TEXT(10), imageFolder TEXT(200),
  description TEXT(2000), image TEXT(100), title TEXT(100), databaseVersion INTEGER);
CREATE TABLE countries (countryID INTEGER, continent INTEGER, countryName TEXT(100), population INTEGER,
  economy INTEGER, wrestlingPopularity INTEGER, preferredStyle TEXT(50));
CREATE TABLE regions (regionID INTEGER, regionParent INTEGER, regionName TEXT(100), population INTEGER,
  preferredStyle TEXT(50), wrestlingPopularity INTEGER);
CREATE TABLE workers (workerID INTEGER, name TEXT(100), picture TEXT(50), status TEXT(25), birthDate TEXT(10),
  style VARCHAR(25), build VARCHAR(25), wrestlingSkill REAL, entertainment REAL, sexAppeal REAL, starPower REAL,
  intimidation REAL, neckCondition REAL, backCondition REAL, headCondition REAL, armsCondition INTEGER,
  bodyCondition REAL, legsCondition REAL, stamina REAL, northAmericaPop REAL, southAmericaPop REAL, asiaPop REAL,
  oceaniaPop REAL, africaPop REAL, europePop REAL, basedIn TEXT(20), birthPlace TEXT(20), psychology REAL,
  refereeing REAL, commentary REAL, agent REAL, gender TEXT(10), debutDate TEXT(10), height TEXT, type TEXT,
  weight TEXT, drive TEXT, safety REAL, isMasked INTEGER, quickLearner INTEGER, tough INTEGER, leader INTEGER,
  alcoholic INTEGER, birthPlaceCountry INTEGER, birthPlaceRegion INTEGER, basedInRegion INTEGER,
  basedInCountry INTEGER, canBeOwner INTEGER, canBeBooker INTEGER, description TEXT(700));
CREATE TABLE workerpictures (workerPictureID INTEGER, workerID INTEGER, triggerDate TEXT(10), picture TEXT);
CREATE TABLE promotions (promotionID INTEGER, fullName TEXT(100), shortName TEXT(10), basedIn TEXT(20),
  northAmericaPop REAL, southAmericaPop REAL, oceaniaPop REAL, asiaPop REAL, europePop REAL, africaPop REAL,
  style TEXT(50), logo TEXT(200), founded INTEGER, owner INTEGER, booker INTEGER, prestige REAL, money INTEGER,
  status TEXT, debutDate TEXT, parentPromotion INTEGER, travelExpenses TEXT, medicalExpenses TEXT, catering TEXT,
  basedInCountry INTEGER, basedInRegion INTEGER, prodMusic INTEGER, prodCamera INTEGER, prodStageQuality INTEGER,
  prodEditing INTEGER, prodWriting INTEGER, prodPyro INTEGER, prodMarketing INTEGER, prodBackOffice INTEGER);
CREATE TABLE brands (brandID INTEGER, brandName TEXT, promotionID INTEGER, importance TEXT, brandLogo TEXT);
CREATE TABLE contracts (contractID INTEGER, workerID INTEGER, contractName TEXT(120), promotionID INTEGER,
  contractType TEXT(15), role TEXT(20), expiryDate TEXT(10), exclusive INTEGER, wagePerMonth INTEGER,
  wagePerAppearance INTEGER, noHouseShows INTEGER, creativeControl INTEGER, push TEXT(20), brand INTEGER,
  manager INTEGER, isDevelopment INTEGER, travelExpenses INTEGER, contractStartDate TEXT(11), morale INTEGER,
  ironCladContract INTEGER, merchPercentPerAppearance INTEGER, ppvPercentPerAppearance INTEGER,
  gatePercentPerAppearance INTEGER, signingBonus INTEGER, maxAppearancesPerYear INTEGER, isTourContract INTEGER);
CREATE TABLE titles (titleID INTEGER, promotionID INTEGER, name TEXT(60), prestige REAL, created TEXT(10),
  type TEXT(20), currentChampion INTEGER, currentChampion2 INTEGER, currentChampion3 INTEGER, won TEXT(10),
  titleImage TEXT, inactive INTEGER, genderLimits TEXT, weightLimits INTEGER, defences INTEGER, brand INT,
  minWeightLimit TEXT);
CREATE TABLE titlehistory (titleHistoryID INTEGER, workerID1 INTEGER, titleID INTEGER, won TEXT(10),
  lost TEXT(10), workerID2 INTEGER, workerID3 INTEGER, namesAtTheTime TEXT, defences INTEGER);
CREATE TABLE tagteams (tagID INTEGER, worker1 INTEGER, worker2 INTEGER, tagExperience REAL, defaultName TEXT,
  tagStatus INTEGER);
CREATE TABLE promotiontagteams (tagID INTEGER, promotionID INTEGER, tagName TEXT, tagStatus INTEGER);
CREATE TABLE stables (stableID INTEGER, stableName TEXT, promotionID INTEGER, stableImage TEXT);
CREATE TABLE stableworkers (stableID INTEGER, contractID INTEGER, isLeader TEXT(5), stableWorkerID INTEGER);
CREATE TABLE venues (venueID INTEGER, region INTEGER, country INTEGER, venueName TEXT(100), capacity INTEGER,
  promotionExclusivity INTEGER, openDate TEXT(10), closeDate TEXT(10), type TEXT, venueImage TEXT,
  continent TEXT(20));
CREATE TABLE events (eventID INTEGER, eventName TEXT(100), promotionID INTEGER, recurrenceType TEXT(20),
  recurrenceMonth INTEGER, recurrenceWeek INTEGER, logo TEXT, brand INTEGER, monday INTEGER, tuesday INTEGER,
  wednesday INTEGER, thursday INTEGER, friday INTEGER, saturday INTEGER, sunday INTEGER, inactive INTEGER,
  importance INTEGER, preferredContinent TEXT, preferredCountry INTEGER, preferredRegion INTEGER,
  preferredVenue INTEGER);
CREATE TABLE eventDates (dateID INTEGER, eventID INTEGER, date TEXT(10));
CREATE TABLE networks (networkID INTEGER, name TEXT(100), type TEXT(30), size INTEGER, openDate TEXT(11),
  status INTEGER, logo TEXT);
CREATE TABLE networkDeals (dealID INTEGER, startDate TEXT(11), expirationDate TEXT(11), costPerShow INTEGER,
  incomePerViewer INTEGER, incomePerShow INTEGER, eventID INTEGER, status INTEGER, promotionID INTEGER,
  networkID INTEGER, timeslot TEXT, airday TEXT, isLive INTEGER);
CREATE TABLE networkAvailability (networkID INTEGER, continent INTEGER, countryID INTEGER, regionID INTEGER);
CREATE TABLE segments (segmentID INTEGER);
`;

const GIVEN = ['Arlo', 'Bram', 'Cass', 'Dex', 'Ezra', 'Fenn', 'Gus', 'Hale', 'Ivo', 'Jory'];
const FAMILY = ['Quillon', 'Marrow', 'Tessle', 'Vantor'];
const STYLES = ['Technical', 'Brawler', 'High Flyer', 'Entertainer', 'Powerhouse', 'Traditional'];
const PUSHES = ['Main Event', 'Upper Midcard', 'Midcard', 'Lower Midcard', 'Enhancement Talent'];

export interface FixtureOptions {
  /** Leave the workers table out entirely. */
  readonly withoutWorkers?: boolean;
  /** Give worker 1 this style instead of a known one. */
  readonly firstStyle?: string;
  /**
   * Add the data shapes found in installed mods that the engine's cross-record checks refuse
   * (UNITY-12): an active tag team with a member who has died, a second contract between the same
   * person and promotion, and an exclusive contract next to an earlier non-exclusive one.
   */
  readonly withCheckFailures?: boolean;
}

function insert(db: Database, table: string, row: Record<string, SqlValue>): void {
  const columns = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((column) => row[column] ?? null),
  );
}

/** A fictional world: 2 countries, 4 promotions (one opens later), 40 people and their history. */
export async function makeWorldModDatabase(options: FixtureOptions = {}): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(SCHEMA);

  insert(db, 'gameworld', {
    worldName: 'Testverse Classic',
    startDate: '2010-01-04',
    currentDate: '2010-01-04',
    imageFolder: 'TestversePics',
    description: 'A made-up world for tests.',
    title: 'Made up',
    databaseVersion: 7,
  });
  // One country the base map knows (matched by name), one it does not.
  insert(db, 'countries', {
    countryID: 1,
    continent: 'North America',
    countryName: 'United States',
    population: 330000000,
    economy: 100,
    wrestlingPopularity: 75,
  });
  insert(db, 'countries', {
    countryID: 2,
    continent: 'Europe',
    countryName: 'Valdoria',
    population: 4000000,
    economy: 60,
    wrestlingPopularity: 55,
    preferredStyle: 'Strong Style',
  });
  insert(db, 'countries', {
    countryID: 3,
    continent: 'Asia',
    countryName: 'Unused Land',
    population: 1000,
    economy: 10,
    wrestlingPopularity: 5,
  });
  insert(db, 'regions', {
    regionID: 1,
    regionParent: 1,
    regionName: 'Texas',
    population: 29000000,
    wrestlingPopularity: 80,
  });
  insert(db, 'regions', {
    regionID: 2,
    regionParent: 1,
    regionName: 'Lone Prairie',
    population: 5000000,
    wrestlingPopularity: 60,
  });
  insert(db, 'regions', {
    regionID: 3,
    regionParent: 2,
    regionName: 'North Valdoria',
    population: 2500000,
    wrestlingPopularity: 50,
  });
  insert(db, 'regions', {
    regionID: 4,
    regionParent: 2,
    regionName: 'South Valdoria',
    population: 1500000,
    wrestlingPopularity: 50,
  });

  for (let index = 0; index < 40; index += 1) {
    const workerId = index + 1;
    const female = index % 4 === 3;
    const type =
      index === 36
        ? 'Referee'
        : index === 37
          ? 'Announcer'
          : index === 38
            ? 'Staff'
            : index === 39
              ? 'Personality'
              : 'Wrestler';
    const wrestler = type === 'Wrestler';
    insert(db, 'workers', {
      workerID: workerId,
      name: `${GIVEN[index % GIVEN.length] ?? 'Arlo'} ${FAMILY[Math.floor(index / 10)] ?? 'Quillon'}`,
      picture: `Worker ${String(workerId)} (alt).png`,
      status: index === 35 ? 'Retired' : 'Active',
      birthDate:
        index === 34
          ? '2002-05-05'
          : `${String(1970 + (index % 20))}-0${String((index % 9) + 1)}-15`,
      // Worker 35 (born 2002) debuts after the start date.
      debutDate: index === 34 ? '2021-06-01' : `${String(1990 + (index % 20))}-03-01`,
      style:
        index === 0 && options.firstStyle !== undefined
          ? options.firstStyle
          : wrestler
            ? (STYLES[index % STYLES.length] ?? 'Technical')
            : 'Non-Wrestler',
      build: 'Toned',
      height: female ? 'Below Average' : 'Above Average',
      weight: female ? 'Featherweight' : 'Heavyweight',
      gender: female ? 'Female' : 'Male',
      type,
      drive: index % 3 === 0 ? 'Money' : '',
      wrestlingSkill: 40 + (index % 50),
      entertainment: 30 + (index % 60),
      sexAppeal: 40,
      starPower: 20 + index,
      intimidation: 35,
      psychology: 50,
      stamina: 60,
      safety: 70,
      refereeing: type === 'Referee' ? 80 : 5,
      commentary: type === 'Announcer' ? 80 : 5,
      agent: type === 'Staff' ? 75 : 10,
      headCondition: 100,
      neckCondition: 95,
      backCondition: 90,
      armsCondition: 100,
      bodyCondition: 0,
      legsCondition: 88,
      northAmericaPop: 10 + index,
      europePop: index % 5 === 0 ? 30 : 0,
      southAmericaPop: 0,
      asiaPop: 0,
      oceaniaPop: 0,
      africaPop: 0,
      basedIn: index < 30 ? 'North America' : 'Europe',
      birthPlace: 'North America',
      basedInCountry: index < 30 ? 1 : 2,
      basedInRegion: index < 30 ? (index % 2) + 1 : 3,
      birthPlaceCountry: 1,
      birthPlaceRegion: 0,
      isMasked: index === 7 ? 1 : 0,
      quickLearner: index % 6 === 0 ? 1 : 0,
      tough: 1,
      leader: index === 0 ? 1 : 0,
      alcoholic: 0,
      canBeOwner: index === 0 ? 1 : 0,
      canBeBooker: index === 0 ? 1 : 0,
      description: 'A made-up person.',
    });
  }
  // Worker 41 is born after the start date and must be left out.
  insert(db, 'workers', {
    workerID: 41,
    name: 'Kip Future',
    status: 'Active',
    birthDate: '2015-01-01',
    debutDate: '2035-01-01',
    style: 'Technical',
    gender: 'Male',
    type: 'Wrestler',
    height: 'Average',
    weight: 'Lightweight',
    build: 'Average',
  });
  insert(db, 'workerpictures', {
    workerPictureID: 1,
    workerID: 2,
    triggerDate: '2009-01-01',
    picture: 'Worker 2 2009.png',
  });
  insert(db, 'workerpictures', {
    workerPictureID: 2,
    workerID: 2,
    triggerDate: '2015-01-01',
    picture: 'Worker 2 2015.png',
  });

  const promotion = (
    promotionId: number,
    name: string,
    short: string,
    status: string,
    debut: string,
    style: string,
    regionId: number,
    countryId: number,
    prestige: number,
  ): void => {
    insert(db, 'promotions', {
      promotionID: promotionId,
      fullName: name,
      shortName: short,
      basedIn: countryId === 1 ? 'North America' : 'Europe',
      northAmericaPop: countryId === 1 ? 40 : 5,
      europePop: countryId === 2 ? 45 : 2,
      southAmericaPop: 0,
      oceaniaPop: 0,
      asiaPop: 0,
      africaPop: 0,
      style,
      logo: `${short}%20logo.png`,
      founded: Number(debut.slice(0, 4)),
      owner: promotionId === 1 ? 1 : 0,
      booker: 0,
      prestige,
      money: 250000 * promotionId,
      status,
      debutDate: debut,
      parentPromotion: 0,
      travelExpenses: 'None',
      medicalExpenses: 'None',
      catering: 'None',
      basedInCountry: countryId,
      basedInRegion: regionId,
      prodMusic: 0,
      prodCamera: 0,
      prodStageQuality: 0,
      prodEditing: 0,
      prodWriting: 0,
      prodPyro: 0,
      prodMarketing: 0,
      prodBackOffice: 0,
    });
  };
  promotion(
    1,
    'Granite Wrestling Federation',
    'GWF',
    'Active',
    '1995-04-01',
    'Sports Entertainment',
    1,
    1,
    70,
  );
  promotion(2, 'Prairie Pro', 'PP', 'Active', '2003-09-01', 'Traditional', 2, 1, 35);
  promotion(3, 'Valdorian Strong Style', 'VSS', 'Active', '2001-02-01', 'Strong Style', 3, 2, 45);
  promotion(4, 'Tomorrow League', 'TL', 'Inactive', '2014-01-01', 'Pure Wrestling', 4, 2, 10);
  insert(db, 'brands', {
    brandID: 1,
    brandName: 'Granite Prime',
    promotionID: 1,
    importance: 'A-Brand',
    brandLogo: 'Granite Prime.png',
  });

  for (let index = 0; index < 36; index += 1) {
    const workerId = index + 1;
    const promotionId = index < 14 ? 1 : index < 24 ? 2 : index < 32 ? 3 : 0;
    if (promotionId === 0) continue;
    insert(db, 'contracts', {
      contractID: workerId,
      workerID: workerId,
      contractName: '',
      promotionID: promotionId,
      contractType: index % 2 === 0 ? 'Written' : 'PPA',
      role: index % 3 === 0 ? 'Heel' : 'Face',
      expiryDate: index % 5 === 0 ? 'No Expiry' : '2011-06-30',
      exclusive: index % 2 === 0 ? 1 : 0,
      wagePerMonth: 4000 + index * 100,
      wagePerAppearance: 300,
      push: PUSHES[index % PUSHES.length] ?? 'Midcard',
      brand: promotionId === 1 ? 1 : 0,
      manager: 0,
      isDevelopment: 0,
      contractStartDate: '2008-01-01',
      morale: 0,
      gatePercentPerAppearance: 0,
      merchPercentPerAppearance: index === 0 ? 5 : 0,
      ppvPercentPerAppearance: 0,
      signingBonus: 0,
      maxAppearancesPerYear: 0,
      isTourContract: 0,
      travelExpenses: 1,
      creativeControl: index === 0 ? 1 : 0,
    });
  }
  // The crew work for the federation; one contract points at a worker who does not exist.
  for (const workerId of [37, 38, 39, 40]) {
    insert(db, 'contracts', {
      contractID: 100 + workerId,
      workerID: workerId,
      promotionID: 1,
      contractType: 'Written',
      role: 'Face',
      expiryDate: '2012-01-01',
      exclusive: 1,
      wagePerMonth: 2000,
      push: 'Staff',
      brand: 0,
      contractStartDate: '2007-01-01',
    });
  }
  insert(db, 'contracts', {
    contractID: 999,
    workerID: 999,
    promotionID: 1,
    contractType: 'PPA',
    role: 'Face',
    expiryDate: '2011-01-01',
    push: 'Midcard',
  });

  insert(db, 'titles', {
    titleID: 1,
    promotionID: 1,
    name: 'Granite World Championship',
    prestige: 80,
    created: '1995-06-01',
    type: 'Singles',
    currentChampion: 1,
    won: '2009-08-01',
    titleImage: 'Granite World.png',
    inactive: 0,
    genderLimits: 'Men',
    weightLimits: '',
    defences: 3,
    brand: 1,
  });
  insert(db, 'titles', {
    titleID: 2,
    promotionID: 1,
    name: 'Granite Tag Team Championship',
    prestige: 60,
    created: '1999-01-01',
    type: 'Tag',
    currentChampion: 3,
    currentChampion2: 5,
    won: '2009-10-10',
    titleImage: 'Granite Tag.png',
    inactive: 0,
    genderLimits: '',
  });
  insert(db, 'titles', {
    titleID: 3,
    promotionID: 2,
    name: 'Prairie Cruiserweight Title',
    prestige: 30,
    created: '2004-01-01',
    type: 'Singles',
    currentChampion: 0,
    inactive: 1,
    genderLimits: '',
    weightLimits: 'Cruiserweight',
  });
  insert(db, 'titles', {
    titleID: 4,
    promotionID: 4,
    name: 'Tomorrow Title',
    prestige: 10,
    created: '2014-01-01',
    type: 'Singles',
    inactive: 1,
  });
  insert(db, 'titlehistory', {
    titleHistoryID: 1,
    workerID1: 2,
    titleID: 1,
    won: '2008-01-05',
    lost: '2008-11-20',
    defences: 4,
  });
  insert(db, 'titlehistory', {
    titleHistoryID: 2,
    workerID1: 4,
    titleID: 1,
    won: '2008-11-20',
    lost: '2009-08-01',
    defences: 2,
  });
  insert(db, 'titlehistory', {
    titleHistoryID: 3,
    workerID1: 6,
    workerID2: 8,
    titleID: 2,
    won: '2008-03-03',
    lost: '2009-10-10',
    defences: 1,
  });
  insert(db, 'titlehistory', {
    titleHistoryID: 4,
    workerID1: 20,
    titleID: 3,
    won: '2005-01-01',
    lost: '2006-01-01',
    defences: 0,
  });

  insert(db, 'tagteams', {
    tagID: 1,
    worker1: 3,
    worker2: 5,
    tagExperience: 65,
    defaultName: 'The Slate Brothers',
    tagStatus: 1,
  });
  insert(db, 'promotiontagteams', {
    tagID: 1,
    promotionID: 1,
    tagName: 'The Slate Brothers',
    tagStatus: 1,
  });
  insert(db, 'stables', {
    stableID: 1,
    stableName: 'The Quarry',
    promotionID: 1,
    stableImage: 'Quarry.png',
  });
  insert(db, 'stableworkers', { stableID: 1, contractID: 1, isLeader: 'True', stableWorkerID: 1 });

  insert(db, 'venues', {
    venueID: 1,
    region: 1,
    country: 1,
    venueName: 'Granite Dome',
    capacity: 18000,
    openDate: '1990-01-01',
    closeDate: '',
    type: 'Indoor Arena',
    venueImage: 'Granite Dome.png',
    continent: 'North America',
  });
  insert(db, 'venues', {
    venueID: 2,
    region: 3,
    country: 2,
    venueName: 'Old Mill Hall',
    capacity: 800,
    openDate: '1980-01-01',
    type: 'Sports Hall',
    continent: 'Europe',
  });

  insert(db, 'events', {
    eventID: 1,
    eventName: 'Granite Monday',
    promotionID: 1,
    recurrenceType: 'Weekly',
    monday: 1,
    importance: 'Normal',
    inactive: 0,
    brand: 1,
    logo: 'Granite Monday.png',
    preferredVenue: 1,
  });
  insert(db, 'events', {
    eventID: 2,
    eventName: 'Granite Summit',
    promotionID: 1,
    recurrenceType: 'Annual',
    recurrenceMonth: 8,
    recurrenceWeek: 5,
    sunday: 1,
    importance: 'Huge',
    inactive: 0,
  });
  insert(db, 'events', {
    eventID: 3,
    eventName: 'Prairie Nights',
    promotionID: 2,
    recurrenceType: 'Monthly',
    recurrenceWeek: 2,
    saturday: 1,
    importance: 'Unimportant',
    inactive: 0,
    preferredRegion: 2,
  });
  insert(db, 'events', {
    eventID: 4,
    eventName: 'Valdoria Tour',
    promotionID: 3,
    recurrenceType: 'Tour',
    importance: 'High',
    inactive: 0,
    preferredCountry: 2,
  });
  insert(db, 'eventDates', { dateID: 1, eventID: 4, date: '2010-03-06' });
  insert(db, 'eventDates', { dateID: 2, eventID: 4, date: '2010-03-07' });
  insert(db, 'eventDates', { dateID: 3, eventID: 4, date: '2009-03-07' });

  insert(db, 'networks', {
    networkID: 1,
    name: 'Granite Vision',
    type: 'TV Network',
    size: 3,
    openDate: '1980-01-01',
    status: 1,
    logo: 'Granite Vision.png',
  });
  insert(db, 'networks', {
    networkID: 2,
    name: 'Future Stream',
    type: 'Online Streaming',
    size: 2,
    openDate: '2020-01-01',
    status: 1,
  });
  insert(db, 'networkAvailability', { networkID: 1, continent: '', countryID: 1, regionID: 0 });
  insert(db, 'networkDeals', {
    dealID: 1,
    startDate: '2009-01-01',
    expirationDate: '2012-01-01',
    costPerShow: 0,
    incomePerViewer: 2,
    incomePerShow: 50000,
    eventID: 1,
    status: 1,
    promotionID: 1,
    networkID: 1,
    timeslot: 'Prime Time',
    airday: 'Monday',
    isLive: 1,
  });
  insert(db, 'networkDeals', {
    dealID: 2,
    startDate: '2001-01-01',
    expirationDate: '2005-01-01',
    incomePerShow: 1000,
    eventID: 3,
    status: 1,
    promotionID: 2,
    networkID: 1,
    timeslot: 'Late Night',
    airday: 'Saturday',
    isLive: 0,
  });
  if (options.withCheckFailures === true) addCheckFailures(db);
  if (options.withoutWorkers === true) db.run('DROP TABLE workers');
  return db;
}

function addCheckFailures(db: Database): void {
  // Worker 42 has died; the mod still lists an active tag team of them and worker 4.
  insert(db, 'workers', {
    workerID: 42,
    name: 'Osric Vale',
    status: 'Deceased',
    birthDate: '1950-02-02',
    debutDate: '1972-03-01',
    style: 'Brawler',
    gender: 'Male',
    type: 'Wrestler',
    height: 'Average',
    weight: 'Heavyweight',
    build: 'Average',
  });
  insert(db, 'tagteams', {
    tagID: 2,
    worker1: 4,
    worker2: 42,
    tagExperience: 40,
    defaultName: 'The Lantern Pair',
    tagStatus: 1,
  });
  // Worker 3 already has contract 3 with promotion 1: a second one with it.
  insert(db, 'contracts', {
    contractID: 201,
    workerID: 3,
    promotionID: 1,
    contractType: 'PPA',
    role: 'Face',
    expiryDate: '2011-06-30',
    exclusive: 0,
    wagePerAppearance: 200,
    push: 'Midcard',
    contractStartDate: '2009-01-01',
  });
  // Worker 2 has non-exclusive contract 2 with promotion 1; a later exclusive one with promotion 2.
  insert(db, 'contracts', {
    contractID: 202,
    workerID: 2,
    promotionID: 2,
    contractType: 'Written',
    role: 'Heel',
    expiryDate: '2011-06-30',
    exclusive: 1,
    wagePerMonth: 3000,
    push: 'Midcard',
    contractStartDate: '2009-01-01',
  });
}

/** Every row of every table, as the game's C# reader passes them: column name to value. */
export function readTables(db: Database): Record<string, Record<string, unknown>[]> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const names = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  for (const [name] of names[0]?.values ?? []) {
    if (typeof name !== 'string') continue;
    const result = db.exec(`SELECT * FROM "${name}"`)[0];
    tables[name] =
      result === undefined
        ? []
        : result.values.map((values) =>
            Object.fromEntries(
              result.columns.map((column, index) => [column, values[index] ?? null]),
            ),
          );
  }
  return tables;
}
