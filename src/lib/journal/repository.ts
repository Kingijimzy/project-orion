import type { JournalEntryInput } from './validation';
export type JournalRepository = { insertEntry(userId:string, entry:JournalEntryInput):PromiseLike<{data:unknown;error:unknown}> };
/** Small injectable persistence boundary so ownership and append behavior can be tested without live Supabase credentials. */
export async function persistJournalEntry(repository:JournalRepository,userId:string,entry:JournalEntryInput):Promise<unknown>{
  if(!userId)throw new Error('Authenticated user id is required.');
  const {data,error}=await repository.insertEntry(userId,structuredClone(entry));
  if(error)throw new Error('Could not save journal entry.');
  return data;
}
