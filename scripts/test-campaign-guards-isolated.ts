import { sendCampaignEmailWithGuards, SendCampaignParams } from '../api/_emailService.js';
import { getAdminFirestore } from '../api/_firebaseAdmin.js';
import { evaluatePremiumAccess } from '../api/_premiumValidity.js';

// Mock in-memory Firestore database & transaction support
class MockDocSnap {
  constructor(private dataMap: any) {}
  get exists() { return this.dataMap !== undefined; }
  data() { return this.dataMap; }
}

class MockTransaction {
  constructor(private store: Map<string, any>) {}
  async get(docRef: { path: string }) {
    return new MockDocSnap(this.store.get(docRef.path));
  }
  set(docRef: { path: string }, data: any, options?: { merge?: boolean }) {
    const existing = this.store.get(docRef.path) || {};
    if (options?.merge) {
      this.store.set(docRef.path, { ...existing, ...data });
    } else {
      this.store.set(docRef.path, data);
    }
  }
}

class MockDocRef {
  constructor(public path: string) {}
  collection(name: string) {
    return new MockCollectionRef(`${this.path}/${name}`);
  }
}

class MockCollectionRef {
  constructor(public path: string) {}
  doc(id: string) {
    return new MockDocRef(`${this.path}/${id}`);
  }
}

class MockFirestore {
  public store = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionRef(`/${name}`);
  }

  async runTransaction(updateFunction: (transaction: MockTransaction) => Promise<any>) {
    const transaction = new MockTransaction(this.store);
    return updateFunction(transaction);
  }
}

async function runIsolatedTests() {
  console.log('Running Isolated Campaign Guards Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, msg: string) {
    if (cond) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // Inject mocks by wrapping the execution or setting up a test helper if needed.
  // Since sendCampaignEmailWithGuards uses getAdminFirestore() and global fetch,
  // let's check how we can test the exact logic safely without modifying production exports.

  console.log('Test Suite Complete: Structure analyzed.');
}

runIsolatedTests();
