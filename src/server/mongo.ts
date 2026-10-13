import { MongoClient, Db } from 'mongodb';
import {
  SEED_PROJECTS,
  SEED_BLOGS,
  SEED_REVIEWS,
  SEED_STAFF,
  SEED_CLIENTS,
  SEED_OFFICES,
  SEED_TEAMS,
  SEED_SETTINGS,
} from './seedData.ts';

export interface MongoCollection<T = any> {
  find(filter?: any, options?: { sort?: any; limit?: number; skip?: number }): Promise<T[]>;
  findOne(filter: any): Promise<T | null>;
  insertOne(doc: T): Promise<{ insertedId: string; acknowledged: boolean }>;
  insertMany(docs: T[]): Promise<{ insertedIds: Record<number, string>; acknowledged: boolean }>;
  updateOne(filter: any, update: any, options?: { upsert?: boolean }): Promise<{ matchedCount: number; modifiedCount: number; upsertedId?: string }>;
  updateMany(filter: any, update: any): Promise<{ matchedCount: number; modifiedCount: number }>;
  deleteOne(filter: any): Promise<{ deletedCount: number }>;
  deleteMany(filter: any): Promise<{ deletedCount: number }>;
  countDocuments(filter?: any): Promise<number>;
}

class InMemoryCollection<T = any> implements MongoCollection<T> {
  private docs: any[] = [];

  constructor(initialDocs: any[] = []) {
    this.docs = JSON.parse(JSON.stringify(initialDocs));
  }

  private matchesFilter(doc: any, filter?: any): boolean {
    if (!filter || Object.keys(filter).length === 0) return true;
    for (const [key, value] of Object.entries(filter)) {
      if (key === '$or' && Array.isArray(value)) {
        if (!value.some((subFilter) => this.matchesFilter(doc, subFilter))) return false;
        continue;
      }
      if (key === '$and' && Array.isArray(value)) {
        if (!value.every((subFilter) => this.matchesFilter(doc, subFilter))) return false;
        continue;
      }
      const docVal = doc[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const valObj = value as Record<string, any>;
        if ('$ne' in valObj && docVal === valObj.$ne) return false;
        if ('$in' in valObj && Array.isArray(valObj.$in) && !valObj.$in.includes(docVal)) return false;
        if ('$nin' in valObj && Array.isArray(valObj.$nin) && valObj.$nin.includes(docVal)) return false;
        if ('$regex' in valObj) {
          const reg = new RegExp(valObj.$regex, valObj.$options || 'i');
          if (!reg.test(String(docVal || ''))) return false;
        }
      } else {
        if (docVal !== value) return false;
      }
    }
    return true;
  }

  async find(filter: any = {}, options: { sort?: any; limit?: number; skip?: number } = {}): Promise<T[]> {
    let results = this.docs.filter((doc) => this.matchesFilter(doc, filter));
    if (options.sort) {
      const [sortKey, sortDir] = Object.entries(options.sort)[0] as [string, number];
      results.sort((a, b) => {
        if (a[sortKey] < b[sortKey]) return sortDir === -1 ? 1 : -1;
        if (a[sortKey] > b[sortKey]) return sortDir === -1 ? -1 : 1;
        return 0;
      });
    }
    if (options.skip) results = results.slice(options.skip);
    if (options.limit) results = results.slice(0, options.limit);
    return JSON.parse(JSON.stringify(results));
  }

  async findOne(filter: any): Promise<T | null> {
    const doc = this.docs.find((d) => this.matchesFilter(d, filter));
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  async insertOne(doc: any): Promise<{ insertedId: string; acknowledged: boolean }> {
    const copy = { ...doc };
    if (!copy._id) copy._id = copy.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.docs.push(copy);
    return { insertedId: copy._id, acknowledged: true };
  }

  async insertMany(docs: any[]): Promise<{ insertedIds: Record<number, string>; acknowledged: boolean }> {
    const insertedIds: Record<number, string> = {};
    docs.forEach((doc, idx) => {
      const copy = { ...doc };
      if (!copy._id) copy._id = copy.id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      this.docs.push(copy);
      insertedIds[idx] = copy._id;
    });
    return { insertedIds, acknowledged: true };
  }

  async updateOne(filter: any, update: any, options: { upsert?: boolean } = {}): Promise<{ matchedCount: number; modifiedCount: number; upsertedId?: string }> {
    const idx = this.docs.findIndex((d) => this.matchesFilter(d, filter));
    if (idx === -1) {
      if (options.upsert) {
        const newDoc = {
          ...filter,
          ...(update.$set || update),
          _id: filter._id || filter.id || `doc_${Date.now()}`,
        };
        this.docs.push(newDoc);
        return { matchedCount: 0, modifiedCount: 1, upsertedId: newDoc._id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const current = this.docs[idx];
    if (update.$set) Object.assign(current, update.$set);
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) delete current[k];
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(filter: any, update: any): Promise<{ matchedCount: number; modifiedCount: number }> {
    let count = 0;
    for (const current of this.docs) {
      if (this.matchesFilter(current, filter)) {
        if (update.$set) Object.assign(current, update.$set);
        if (update.$unset) {
          for (const k of Object.keys(update.$unset)) delete current[k];
        }
        count++;
      }
    }
    return { matchedCount: count, modifiedCount: count };
  }

  async deleteOne(filter: any): Promise<{ deletedCount: number }> {
    const idx = this.docs.findIndex((d) => this.matchesFilter(d, filter));
    if (idx !== -1) {
      this.docs.splice(idx, 1);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(filter: any): Promise<{ deletedCount: number }> {
    const initialLen = this.docs.length;
    this.docs = this.docs.filter((d) => !this.matchesFilter(d, filter));
    return { deletedCount: initialLen - this.docs.length };
  }

  async countDocuments(filter?: any): Promise<number> {
    return this.docs.filter((d) => this.matchesFilter(d, filter)).length;
  }
}

class RealMongoCollectionAdapter<T = any> implements MongoCollection<T> {
  constructor(private raw: any) {}

  async find(filter: any = {}, options: any = {}): Promise<T[]> {
    let cursor = this.raw.find(filter);
    if (options.sort) cursor = cursor.sort(options.sort);
    if (options.skip) cursor = cursor.skip(options.skip);
    if (options.limit) cursor = cursor.limit(options.limit);
    return cursor.toArray();
  }

  async findOne(filter: any): Promise<T | null> {
    return this.raw.findOne(filter);
  }

  async insertOne(doc: T): Promise<any> {
    return this.raw.insertOne(doc);
  }

  async insertMany(docs: T[]): Promise<any> {
    return this.raw.insertMany(docs);
  }

  async updateOne(filter: any, update: any, options: any = {}): Promise<any> {
    return this.raw.updateOne(filter, update, options);
  }

  async updateMany(filter: any, update: any): Promise<any> {
    return this.raw.updateMany(filter, update);
  }

  async deleteOne(filter: any): Promise<any> {
    return this.raw.deleteOne(filter);
  }

  async deleteMany(filter: any): Promise<any> {
    return this.raw.deleteMany(filter);
  }

  async countDocuments(filter: any = {}): Promise<number> {
    return this.raw.countDocuments(filter);
  }
}

let realClient: MongoClient | null = null;
let realDb: Db | null = null;
let isConnectedToRealMongo = false;
const inMemoryCollections = new Map<string, InMemoryCollection>();

function getInitialSeedForCollection(name: string): any[] {
  switch (name) {
    case 'projects': return SEED_PROJECTS;
    case 'blogs': return SEED_BLOGS;
    case 'reviews': return SEED_REVIEWS;
    case 'staff_users': return SEED_STAFF;
    case 'clients': return SEED_CLIENTS;
    case 'offices': return SEED_OFFICES;
    case 'teams': return SEED_TEAMS;
    case 'platform_settings': return [SEED_SETTINGS];
    default: return [];
  }
}

export async function initMongo(): Promise<void> {
  const uri = process.env.MONGODB_URI || 'mongodb+srv://codexdynamics:Qwerty100@cluster0.6shrdkk.mongodb.net/?appName=Cluster0';
  const dbName = process.env.MONGODB_DATABASE || 'codex_dynamics';

  if (uri && uri.trim()) {
    try {
      console.log(`[mongo] Connecting to MongoDB at ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}...`);
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
      await client.connect();
      realClient = client;
      realDb = client.db(dbName);
      isConnectedToRealMongo = true;
      console.log(`[mongo] Connected successfully to database: ${dbName}`);

      // Seed real collections if empty
      const collectionsToCheck = [
        ['projects', SEED_PROJECTS],
        ['blogs', SEED_BLOGS],
        ['reviews', SEED_REVIEWS],
        ['staff_users', SEED_STAFF],
        ['clients', SEED_CLIENTS],
        ['offices', SEED_OFFICES],
        ['teams', SEED_TEAMS],
        ['platform_settings', [SEED_SETTINGS]],
      ] as const;

      for (const [colName, initialData] of collectionsToCheck) {
        const col = realDb.collection(colName);
        const count = await col.countDocuments();
        if (count === 0 && initialData.length > 0) {
          await col.insertMany(initialData as any);
          console.log(`[mongo] Seeded ${initialData.length} records into ${colName}`);
        }
      }
      return;
    } catch (err: any) {
      console.warn(`[mongo] Could not connect to remote MongoDB (${err?.message || err}). Initializing in-memory Mongo collection engine.`);
    }
  } else {
    console.log('[mongo] MONGODB_URI not configured. Initializing active in-memory Mongo collection engine.');
  }

  // Preload in-memory collections with default seeds
  const defaultCollections = ['projects', 'blogs', 'reviews', 'staff_users', 'clients', 'offices', 'teams', 'platform_settings', 'client_projects', 'client_support_tickets', 'notifications', 'messages', 'audit_logs', 'invoices'];
  for (const name of defaultCollections) {
    if (!inMemoryCollections.has(name)) {
      inMemoryCollections.set(name, new InMemoryCollection(getInitialSeedForCollection(name)));
    }
  }
}

export function getMongoCollection<T = any>(name: string): MongoCollection<T> {
  if (isConnectedToRealMongo && realDb) {
    return new RealMongoCollectionAdapter<T>(realDb.collection(name));
  }
  if (!inMemoryCollections.has(name)) {
    inMemoryCollections.set(name, new InMemoryCollection<T>(getInitialSeedForCollection(name)));
  }
  return inMemoryCollections.get(name)! as MongoCollection<T>;
}

export function isMongoConnected(): boolean {
  return isConnectedToRealMongo;
}

export function getDatabaseName(): string {
  return process.env.MONGODB_DATABASE || 'codex_dynamics';
}
