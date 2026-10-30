// These scripts touch only exact keys derived from this deployment and browser.
export const startScript=`-- capture-preview-start-v1
local prior=redis.call('GET',KEYS[1])
if prior then return {'EXISTING',prior} end
for i=3,5 do if redis.call('EXISTS',KEYS[i])==1 then return {'COLLISION'} end end
local count=tonumber(redis.call('GET',KEYS[2]) or '0')
if count>=tonumber(ARGV[1]) then return {'FIXTURE_BUDGET_EXHAUSTED'} end
redis.call('INCR',KEYS[2])
redis.call('EXPIRE',KEYS[2],ARGV[2])
redis.call('SET',KEYS[1],ARGV[3],'EX',ARGV[4])
redis.call('SET',KEYS[3],ARGV[5],'EX',ARGV[4])
redis.call('SET',KEYS[4],ARGV[6],'EX',ARGV[4])
redis.call('SET',KEYS[5],ARGV[7],'EX',ARGV[4])
return {'CREATED',ARGV[3]}`;
export const rateScript=`-- capture-preview-rate-v1
local n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end
return n`;
