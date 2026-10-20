import { MongoClient, Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  SEED_BLOGS,
  SEED_REVIEWS,
  SEED_STAFF,
  SEED_CLIENTS,
  SEED_OFFICES,
  SEED_TEAMS,
  SEED_SETTINGS,
  SEED_PROJECTS,
  SEED_PROJECT_CATEGORIES,
  SEED_CLIENT_PROJECTS,
  SEED_INVOICES,
} from './seedData.ts';

export interface MongoCollection<T = any> {
  find(filter?: any, options?: { sort?: any; limit?: number; skip?: number; projection?: any }): Promise<T[]>;
  findOne(filter: any): Promise<T | null>;
  insertOne(doc: T): Promise<{ insertedId: string; acknowledged: boolean }>;
  insertMany(docs: T[]): Promise<{ insertedIds: Record<number, string>; acknowledged: boolean }>;
  updateOne(filter: any, update: any, options?: { upsert?: boolean }): Promise<{ matchedCount: number; modifiedCount: number; upsertedId?: string }>;
  updateMany(filter: any, update: any): Promise<{ matchedCount: number; modifiedCount: number }>;
  deleteOne(filter: any): Promise<{ deletedCount: number }>;
  deleteMany(filter: any): Promise<{ deletedCount: number }>;
  countDocuments(filter?: any): Promise<number>;
}

class MongoCollectionAdapter<T = any> implements MongoCollection<T> {
  constructor(private readonly collection: any) {}

  async find(filter: any = {}, options: { sort?: any; limit?: number; skip?: number; projection?: any } = {}): Promise<T[]> {
    let cursor = this.collection.find(filter);
    if (options.projection) cursor = cursor.project(options.projection);
    if (options.sort) cursor = cursor.sort(options.sort);
    if (options.skip) cursor = cursor.skip(options.skip);
    if (options.limit) cursor = cursor.limit(options.limit);
    return cursor.toArray();
  }

  findOne(filter: any): Promise<T | null> {
    return this.collection.findOne(filter);
  }

  insertOne(doc: T): Promise<any> {
    return this.collection.insertOne(doc);
  }

  insertMany(docs: T[]): Promise<any> {
    return this.collection.insertMany(docs);
  }

  updateOne(filter: any, update: any, options: { upsert?: boolean } = {}): Promise<any> {
    return this.collection.updateOne(filter, update, options);
  }

  updateMany(filter: any, update: any): Promise<any> {
    return this.collection.updateMany(filter, update);
  }

  deleteOne(filter: any): Promise<any> {
    return this.collection.deleteOne(filter);
  }

  deleteMany(filter: any): Promise<any> {
    return this.collection.deleteMany(filter);
  }

  countDocuments(filter: any = {}): Promise<number> {
    return this.collection.countDocuments(filter);
  }
}

// ---------------------------------------------------------------------------
// IN-MEMORY FALLBACK DATABASE
// ---------------------------------------------------------------------------
function matchesFilter(doc: any, filter: any): boolean {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const key of Object.keys(filter)) {
    const filterVal = filter[key];

    if (key === '$or' && Array.isArray(filterVal)) {
      if (!filterVal.some((subFilter) => matchesFilter(doc, subFilter))) return false;
      continue;
    }
    if (key === '$and' && Array.isArray(filterVal)) {
      if (!filterVal.every((subFilter) => matchesFilter(doc, subFilter))) return false;
      continue;
    }
    if (key === '$nor' && Array.isArray(filterVal)) {
      if (filterVal.some((subFilter) => matchesFilter(doc, subFilter))) return false;
      continue;
    }

    const docVal = doc[key];
    const isDocValMissingOrNull = docVal === undefined || docVal === null;

    if (
      filterVal &&
      typeof filterVal === 'object' &&
      !Array.isArray(filterVal) &&
      !(filterVal instanceof RegExp) &&
      !(filterVal instanceof Date)
    ) {
      const opKeys = Object.keys(filterVal);
      const isOperator = opKeys.some((k) => k.startsWith('$'));
      if (isOperator) {
        for (const op of opKeys) {
          const expected = filterVal[op];
          if (op === '$exists') {
            const exists = docVal !== undefined;
            if (exists !== Boolean(expected)) return false;
          } else if (op === '$ne') {
            if (expected === null) {
              if (isDocValMissingOrNull) return false;
            } else if (docVal === expected) {
              return false;
            }
          } else if (op === '$eq') {
            if (expected === null) {
              if (!isDocValMissingOrNull) return false;
            } else if (docVal !== expected && !(docVal != null && String(docVal) === String(expected))) {
              return false;
            }
          } else if (op === '$in') {
            if (!Array.isArray(expected)) return false;
            const matches = expected.some((item) => {
              if (item === null || item === undefined) return isDocValMissingOrNull;
              return item === docVal || (docVal != null && String(item) === String(docVal));
            });
            if (!matches) return false;
          } else if (op === '$nin') {
            if (!Array.isArray(expected)) return false;
            const matches = expected.some((item) => {
              if (item === null || item === undefined) return isDocValMissingOrNull;
              return item === docVal || (docVal != null && String(item) === String(docVal));
            });
            if (matches) return false;
          } else if (op === '$gt') {
            if (!(docVal > expected)) return false;
          } else if (op === '$gte') {
            if (!(docVal >= expected)) return false;
          } else if (op === '$lt') {
            if (!(docVal < expected)) return false;
          } else if (op === '$lte') {
            if (!(docVal <= expected)) return false;
          } else if (op === '$regex') {
            const re = new RegExp(expected, filterVal.$options || 'i');
            if (!re.test(String(docVal ?? ''))) return false;
          }
        }
        continue;
      }
    }

    if (filterVal instanceof RegExp) {
      if (!filterVal.test(String(docVal ?? ''))) return false;
      continue;
    }

    if (filterVal === null || filterVal === undefined) {
      if (!isDocValMissingOrNull) return false;
      continue;
    }

    if (docVal !== filterVal) {
      if (docVal != null && filterVal != null && String(docVal) === String(filterVal)) {
        continue;
      }
      return false;
    }
  }

  return true;
}

function sortDocs(docs: any[], sort: any): any[] {
  if (!sort) return docs;
  const sortKeys = Object.keys(sort);
  if (sortKeys.length === 0) return docs;

  return [...docs].sort((a, b) => {
    for (const key of sortKeys) {
      const dir = sort[key] === -1 || sort[key] === 'desc' ? -1 : 1;
      const aVal = a[key];
      const bVal = b[key];
      if (aVal === bVal) continue;
      if (aVal === undefined || aVal === null) return 1;
      if (bVal === undefined || bVal === null) return -1;
      return aVal > bVal ? dir : -dir;
    }
    return 0;
  });
}

function applyUpdate(doc: any, update: any): boolean {
  if (!update || typeof update !== 'object') return false;
  let modified = false;

  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) {
      doc[k] = v;
      modified = true;
    }
  }
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      doc[k] = (Number(doc[k]) || 0) + Number(v);
      modified = true;
    }
  }
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      const arr = Array.isArray(doc[k]) ? doc[k] : [];
      arr.push(v);
      doc[k] = arr;
      modified = true;
    }
  }
  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) {
      delete doc[k];
      modified = true;
    }
  }

  const hasOperators = Object.keys(update).some((k) => k.startsWith('$'));
  if (!hasOperators) {
    for (const [k, v] of Object.entries(update)) {
      doc[k] = v;
      modified = true;
    }
  }

  return modified;
}

class MemoryCollectionAdapter<T = any> implements MongoCollection<T> {
  private docs: T[] = [];

  constructor(initialData: T[] = []) {
    this.docs = JSON.parse(JSON.stringify(initialData));
  }

  async find(filter: any = {}, options: { sort?: any; limit?: number; skip?: number; projection?: any } = {}): Promise<T[]> {
    let matched = this.docs.filter((doc) => matchesFilter(doc, filter));
    if (options.sort) {
      matched = sortDocs(matched, options.sort);
    }
    if (options.skip) {
      matched = matched.slice(options.skip);
    }
    if (options.limit && options.limit > 0) {
      matched = matched.slice(0, options.limit);
    }
    return JSON.parse(JSON.stringify(matched));
  }

  async findOne(filter: any): Promise<T | null> {
    const doc = this.docs.find((d) => matchesFilter(d, filter));
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  async insertOne(doc: T): Promise<{ insertedId: string; acknowledged: boolean }> {
    const cloned = JSON.parse(JSON.stringify(doc)) as any;
    if (!cloned.id && !cloned._id) {
      cloned.id = randomUUID();
      cloned._id = cloned.id;
    } else if (!cloned._id && cloned.id) {
      cloned._id = cloned.id;
    } else if (!cloned.id && cloned._id) {
      cloned.id = String(cloned._id);
    }
    this.docs.push(cloned);
    return { insertedId: String(cloned._id || cloned.id), acknowledged: true };
  }

  async insertMany(docs: T[]): Promise<{ insertedIds: Record<number, string>; acknowledged: boolean }> {
    const insertedIds: Record<number, string> = {};
    docs.forEach((d, idx) => {
      const cloned = JSON.parse(JSON.stringify(d)) as any;
      if (!cloned.id && !cloned._id) {
        cloned.id = randomUUID();
        cloned._id = cloned.id;
      }
      this.docs.push(cloned);
      insertedIds[idx] = String(cloned._id || cloned.id);
    });
    return { insertedIds, acknowledged: true };
  }

  async updateOne(filter: any, update: any, options: { upsert?: boolean } = {}): Promise<{ matchedCount: number; modifiedCount: number; upsertedId?: string }> {
    const index = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (index === -1) {
      if (options.upsert) {
        const newDoc: any = { id: randomUUID(), ...filter };
        applyUpdate(newDoc, update);
        this.docs.push(newDoc);
        return { matchedCount: 0, modifiedCount: 1, upsertedId: newDoc.id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const modified = applyUpdate(this.docs[index], update);
    return { matchedCount: 1, modifiedCount: modified ? 1 : 0 };
  }

  async updateMany(filter: any, update: any): Promise<{ matchedCount: number; modifiedCount: number }> {
    let matchedCount = 0;
    let modifiedCount = 0;
    for (const doc of this.docs) {
      if (matchesFilter(doc, filter)) {
        matchedCount++;
        if (applyUpdate(doc, update)) {
          modifiedCount++;
        }
      }
    }
    return { matchedCount, modifiedCount };
  }

  async deleteOne(filter: any): Promise<{ deletedCount: number }> {
    const index = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (index >= 0) {
      this.docs.splice(index, 1);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(filter: any): Promise<{ deletedCount: number }> {
    const initialLen = this.docs.length;
    this.docs = this.docs.filter((d) => !matchesFilter(d, filter));
    return { deletedCount: initialLen - this.docs.length };
  }

  async countDocuments(filter: any = {}): Promise<number> {
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  }
}

// In-memory collection registry
const memoryCollections = new Map<string, MemoryCollectionAdapter>();

function getOrCreateMemoryCollection<T = any>(name: string, seed: any[] = []): MemoryCollectionAdapter<T> {
  if (!memoryCollections.has(name)) {
    memoryCollections.set(name, new MemoryCollectionAdapter<T>(seed));
  }
  return memoryCollections.get(name)! as MemoryCollectionAdapter<T>;
}

function initMemoryDatabase() {
  getOrCreateMemoryCollection('blogs', SEED_BLOGS);
  getOrCreateMemoryCollection('reviews', SEED_REVIEWS);
  getOrCreateMemoryCollection('staff_users', SEED_STAFF);
  getOrCreateMemoryCollection('clients', SEED_CLIENTS);
  getOrCreateMemoryCollection('offices', SEED_OFFICES);
  getOrCreateMemoryCollection('teams', SEED_TEAMS);
  getOrCreateMemoryCollection('platform_settings', [SEED_SETTINGS]);
  getOrCreateMemoryCollection('projects', SEED_PROJECTS);
  getOrCreateMemoryCollection('project_categories', SEED_PROJECT_CATEGORIES);
  getOrCreateMemoryCollection('client_projects', SEED_CLIENT_PROJECTS);
  getOrCreateMemoryCollection('invoices', SEED_INVOICES);
  console.log('[mongo] In-memory database initialized with seeded initial datasets.');
}

let realDb: Db | null = null;
let isConnectedToRealMongo = false;
let isInitialized = false;

export async function initMongo(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DATABASE || 'codex_dynamics';

  if (!uri || (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://'))) {
    console.warn('[mongo] No MONGODB_URI configured. Falling back to in-memory store.');
    initMemoryDatabase();
    isInitialized = true;
    return;
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    await db.collection('clients').createIndex(
      { is_bin: 1, deleted_at: 1, _id: -1 },
      { name: 'clients_visibility_sort' },
    );
    const collectionsToCheck = [
      ['blogs', SEED_BLOGS],
      ['reviews', SEED_REVIEWS],
      ['staff_users', SEED_STAFF],
      ['clients', SEED_CLIENTS],
      ['offices', SEED_OFFICES],
      ['teams', SEED_TEAMS],
      ['platform_settings', [SEED_SETTINGS]],
      ['projects', SEED_PROJECTS],
      ['project_categories', SEED_PROJECT_CATEGORIES],
      ['client_projects', SEED_CLIENT_PROJECTS],
      ['invoices', SEED_INVOICES],
    ] as const;

    for (const [collectionName, initialData] of collectionsToCheck) {
      const collection = db.collection(collectionName);
      const count = await collection.countDocuments();
      if (count === 0 && initialData.length > 0) {
        await collection.insertMany(initialData as any);
        console.log(`[mongo] Seeded ${initialData.length} records into ${collectionName}`);
      }
    }

    realDb = db;
    isConnectedToRealMongo = true;
    isInitialized = true;
    console.log(`[mongo] Connected to database: ${dbName}`);
  } catch (err) {
    await client.close().catch(() => {});
    console.warn('[mongo] Could not connect to remote MongoDB. Falling back to in-memory store.');
    initMemoryDatabase();
    isInitialized = true;
  }
}

export function getMongoCollection<T = any>(name: string): MongoCollection<T> {
  if (isConnectedToRealMongo && realDb) {
    return new MongoCollectionAdapter<T>(realDb.collection(name));
  }
  if (!isInitialized) {
    initMemoryDatabase();
    isInitialized = true;
  }
  return getOrCreateMemoryCollection<T>(name);
}

export function isMongoConnected(): boolean {
  return isConnectedToRealMongo || isInitialized;
}

export function isUsingRealMongo(): boolean {
  return isConnectedToRealMongo;
}

export function getDatabaseName(): string {
  return process.env.MONGODB_DATABASE || 'codex_dynamics';
}
