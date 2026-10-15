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

class MongoCollectionAdapter<T = any> implements MongoCollection<T> {
  constructor(private readonly collection: any) {}

  async find(filter: any = {}, options: { sort?: any; limit?: number; skip?: number } = {}): Promise<T[]> {
    let cursor = this.collection.find(filter);
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

let realDb: Db | null = null;
let isConnectedToRealMongo = false;

export async function initMongo(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  const dbName = process.env.MONGODB_DATABASE || 'codex_dynamics';
  if (!uri) {
    throw new Error('MONGODB_URI is required. CRM APIs only run with MongoDB configured.');
  }
  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme.');
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  try {
    await client.connect();
    const db = client.db(dbName);
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
    console.log(`[mongo] Connected to database: ${dbName}`);
  } catch {
    await client.close().catch(() => {});
    console.error('[mongo] Could not connect to or initialize the configured MongoDB database.');
    throw new Error('MongoDB connection or initialization failed. CRM APIs are unavailable.');
  }
}

export function getMongoCollection<T = any>(name: string): MongoCollection<T> {
  if (!isConnectedToRealMongo || !realDb) {
    throw new Error('MongoDB is not connected. CRM data is unavailable.');
  }
  return new MongoCollectionAdapter<T>(realDb.collection(name));
}

export function isMongoConnected(): boolean {
  return isConnectedToRealMongo;
}

export function getDatabaseName(): string {
  return process.env.MONGODB_DATABASE || 'codex_dynamics';
}
