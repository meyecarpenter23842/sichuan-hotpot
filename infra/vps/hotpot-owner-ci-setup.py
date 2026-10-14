#!/usr/bin/python3
"""OWNER-approved, CI-deployed first-admin bootstrap. No password enters GitHub."""
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib import request, error
import urllib.parse

ENV=Path("/etc/sichuan-hotpot/api.env")
API=Path("/opt/sichuan-hotpot/current/apps/api")
SENDER="noreply@bepsi.click"
# The recipient below is an approved first-owner contact, not an authentication secret.
USERNAME="khuongbinh"
EMAIL="khuongbinh.info@gmail.com"

JS=r"""
'use strict';
const {createRequire}=require('node:module');
const {randomBytes}=require('node:crypto');
const path='/opt/sichuan-hotpot/current/apps/api/package.json';
const requireApp=createRequire(path);
const {PrismaClient,Prisma}=requireApp('@prisma/client');
const {Algorithm,hash}=requireApp('@node-rs/argon2');
const db=new PrismaClient();
const USER=process.env.BOOTSTRAP_USERNAME;
const EMAIL=process.env.BOOTSTRAP_EMAIL;
(async()=>{
  const temporaryPassword=await hash(randomBytes(48).toString('base64url'),{
    algorithm:Algorithm.Argon2id,memoryCost:19456,timeCost:2,parallelism:1,outputLen:32
  });
  const result=await db.$transaction(async tx=>{
    // Single-writer transaction: protect the invariant globally.
    await tx.$queryRawUnsafe('SELECT 1 AS acquired FROM pg_advisory_xact_lock(787,6)');
    const owner=await tx.user.findFirst({
      where:{role:'OWNER'},select:{localCredential:{select:{
        normalizedUsername:true,verifiedEmail:true
      }}}
    });
    if(owner){
      if(owner.localCredential?.normalizedUsername===USER &&
         owner.localCredential?.verifiedEmail===EMAIL) return 'ALREADY_EXISTS';
      throw Error('owner_exists_different_account');
    }
    const collision=await tx.localCredential.findFirst({
      where:{OR:[{normalizedUsername:USER},{verifiedEmail:EMAIL}]},select:{id:true}
    });
    if(collision) throw Error('identity_collision');
    await tx.localCredential.create({data:{
      normalizedUsername:USER,verifiedEmail:EMAIL,passwordHash:temporaryPassword,
      user:{create:{role:'OWNER'}}
    }});
    return 'CREATED';
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  console.log('owner_database='+result);
})().catch((failure)=>{
  const reason=failure?.message==='owner_exists_different_account' ? 'other_owner' :
    failure?.message==='identity_collision' ? 'identity_collision' :
    failure?.code==='P2021' ? 'schema_not_ready' : 'runtime_failure';
  console.log('owner_database=BLOCKED;reason='+reason);
  process.exitCode=2;
}).finally(async()=>{await db.$disconnect();});
"""

class Blocked(Exception):
    pass

def require(condition, reason):
    if not condition:
        raise Blocked(reason)

def checked_environment():
    st=ENV.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_mode & 0o137==0,
            "unsafe_environment")
    require(st.st_size<=65536,"environment_too_large")
    pairs={}
    for row in ENV.read_text().splitlines():
        if row and not row.startswith("#"):
            k,sep,v=row.partition("=")
            require(bool(sep) and k not in pairs,"bad_environment")
            pairs[k]=v
    require(pairs.get("HOTPOT_MAIL_FROM")==SENDER,"sender_not_configured")
    require(bool(re.fullmatch(r"re_[A-Za-z0-9_-]{20,150}",pairs.get("RESEND_API_KEY",""))),
            "resend_not_configured")
    parts=urllib.parse.urlsplit(pairs.get("DATABASE_URL",""))
    require(parts.scheme=="postgresql" and parts.hostname=="127.0.0.1" and
            parts.port==5432 and parts.username=="hotpot_app" and parts.path=="/hotpot",
            "unsafe_database")
    require(API.is_dir() and (API/"package.json").is_file(),"api_release_missing")
    return pairs["DATABASE_URL"]

def create_owner(dburl):
    env={"PATH":"/usr/bin:/bin","HOME":"/var/lib/sichuan-hotpot/api",
         "DATABASE_URL":dburl,"BOOTSTRAP_USERNAME":USERNAME,"BOOTSTRAP_EMAIL":EMAIL}
    p=subprocess.run(["/usr/sbin/runuser","-u","hotpot-api","--","/usr/bin/node",
                       "-e",JS],cwd=API,env=env,stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL,timeout=30,check=False)
    lines=p.stdout.decode("utf-8","replace").splitlines()
    if p.returncode != 0 and len(lines)==1 and re.fullmatch(
            r"owner_database=BLOCKED;reason=(other_owner|identity_collision|schema_not_ready|runtime_failure)",
            lines[0]):
        raise Blocked("database_"+lines[0].split("reason=",1)[1])
    require(p.returncode==0 and len(lines)==1 and lines[0] in
            ("owner_database=CREATED","owner_database=ALREADY_EXISTS"),
            "database_bootstrap_failed")
    return lines[0].split("=")[1]

def issue_password_reset():
    payload=json.dumps({"email":EMAIL}).encode()
    rq=request.Request("http://127.0.0.1:3000/auth/password/request-code",
        data=payload,headers={"Content-Type":"application/json"},method="POST")
    try:
        with request.urlopen(rq,timeout=14) as res:
            require(res.status==201,"reset_request_rejected")
            body=json.loads(res.read(2048))
            require(body.get("status")=="sent","reset_request_failed")
    except (error.HTTPError,error.URLError,OSError,ValueError):
        raise Blocked("reset_email_not_sent")

def main():
    require(os.geteuid()==0,"root_required")
    os.umask(0o077)
    url=checked_environment()
    state=create_owner(url)
    print("owner_record="+state,flush=True)
    issue_password_reset()
    print("owner_reset_otp=REQUESTED;password_exposed=no",flush=True)

if __name__=="__main__":
    try:
        main()
    except Blocked as exc:
        print("owner_setup=BLOCKED;reason="+str(exc),file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("owner_setup=BLOCKED;reason=operation_failed",file=sys.stderr)
        sys.exit(2)
