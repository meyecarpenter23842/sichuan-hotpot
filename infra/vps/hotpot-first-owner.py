#!/usr/bin/python3
"""One-time email-verified OWNER bootstrap; credentials/OTP via SSH stdin only."""
import hmac
import json
import os
from pathlib import Path
import re
import select
import stat
import subprocess
import sys
import time
from urllib import request, error, parse
import secrets

ENV=Path("/etc/sichuan-hotpot/api.env")
API=Path("/opt/sichuan-hotpot/current/apps/api")
NODE_JS=r"""
'use strict';
const {createRequire}=require('node:module');
const fs=require('node:fs');
const appRequire=createRequire('/opt/sichuan-hotpot/current/apps/api/package.json');
const {PrismaClient,Prisma}=appRequire('@prisma/client');
const {hash,Algorithm}=appRequire('@node-rs/argon2');
const db=new PrismaClient();
const mode=process.argv.at(-1);
let input;
try {input=JSON.parse(fs.readFileSync(0,'utf8'));} catch {process.exit(2);}
async function eligible(tx) {
  const owners=await tx.user.count({where:{role:'OWNER'}});
  const branches=await tx.branch.count();
  const taken=await tx.localCredential.count({where:{OR:[
    {normalizedUsername:input.username},{verifiedEmail:input.email}
  ]}});
  return owners===0 && branches>0 && taken===0;
}
(async()=>{
  if (mode==='preflight') {
    if (!await eligible(db)) throw Error('not eligible');
    process.stdout.write('owner_db=AVAILABLE\n');
  } else if(mode==='create') {
    const passwordHash=await hash(input.password,{
      algorithm:Algorithm.Argon2id,memoryCost:19456,timeCost:2,parallelism:1,outputLen:32
    });
    await db.$transaction(async tx=>{
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(787,6)');
      if (!await eligible(tx)) throw Error('not eligible');
      await tx.localCredential.create({data:{
        normalizedUsername:input.username,verifiedEmail:input.email,passwordHash,
        user:{create:{role:'OWNER'}}
      }});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    process.stdout.write('owner_db=PASS\n');
  } else throw Error('invalid mode');
})().catch(()=>{
  process.stdout.write('owner_db=BLOCKED\n');process.exitCode=2;
}).finally(async()=>{await db.$disconnect();});
"""

class Blocked(Exception):
    pass

def require(ok, code):
    if not ok:
        raise Blocked(code)

def parse_identity(raw):
    require(len(raw)<=512, "invalid_input")
    try:
        obj=json.loads(raw)
    except (ValueError,UnicodeDecodeError):
        raise Blocked("invalid_input")
    require(isinstance(obj,dict) and set(obj)=={"username","email","password"}, "invalid_input")
    username,email,password=obj["username"],obj["email"],obj["password"]
    require(isinstance(username,str) and bool(re.fullmatch(r"[a-z][a-z0-9._-]{2,31}",username)),"invalid_username")
    require(isinstance(email,str) and len(email)<=254 and
            bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email)) and
            email==email.strip().lower(),"invalid_email")
    require(isinstance(password,str) and 6<=len(password)<=128 and
            not any(ch in password for ch in ("\r","\n","\x00")),"invalid_password")
    return obj

def checked_env():
    st=ENV.lstat()
    require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_mode & 0o137==0,"unsafe_environment")
    require(st.st_size<=65536,"invalid_environment")
    mapping={}
    for row in ENV.read_text().splitlines():
        if not row or row.startswith("#"):
            continue
        key,sep,value=row.partition("=")
        require(bool(sep) and key not in mapping,"invalid_environment")
        mapping[key]=value
    require(mapping.get("HOTPOT_MAIL_FROM")=="noreply@bepsi.click","unverified_sender")
    require(bool(re.fullmatch(r"re_[a-zA-Z0-9_-]{20,150}",mapping.get("RESEND_API_KEY",""))),"mail_unconfigured")
    dburl=parse.urlsplit(mapping.get("DATABASE_URL",""))
    require(dburl.scheme=="postgresql" and dburl.hostname=="127.0.0.1" and
            dburl.port==5432 and dburl.username=="hotpot_app" and
            dburl.path=="/hotpot","unsafe_database")
    require(API.is_dir() and (API/"package.json").is_file(),"api_release_missing")
    return mapping

def node_step(mode,identity,dburl):
    child_env={"PATH":"/usr/bin:/bin","DATABASE_URL":dburl,
               "HOME":"/var/lib/sichuan-hotpot/api"}
    payload=json.dumps(identity,ensure_ascii=True).encode()
    result=subprocess.run(["/usr/sbin/runuser","-u","hotpot-api","--",
        "/usr/bin/node","-e",NODE_JS,mode],cwd=API,env=child_env,input=payload,
        stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20,check=False)
    require(result.returncode==0 and result.stdout==
            ("owner_db="+("AVAILABLE" if mode=="preflight" else "PASS")+"\n").encode(),
            "owner_database_blocked")

def mail_otp(recipient,env,code):
    body=json.dumps({
        "from":env["HOTPOT_MAIL_FROM"],"to":[recipient],
        "subject":"Mã xác minh OWNER Sichuan Hotpot",
        "text":"Mã xác minh chủ cửa hàng: "+code+"\nMã hết hạn sau 10 phút. Không chia sẻ mã này.",
    }).encode()
    req=request.Request("https://api.resend.com/emails",data=body,
        headers={"Authorization":"Bearer "+env["RESEND_API_KEY"],
                 "Content-Type":"application/json"},method="POST")
    try:
        with request.urlopen(req,timeout=12) as response:
            require(200<=response.status<300,"mail_failed")
    except (OSError,TimeoutError,error.HTTPError,error.URLError):
        raise Blocked("mail_failed")

def otp_matches(stdin,expected,issued_at):
    remaining=max(0,600-(time.monotonic()-issued_at))
    readable,_,_=select.select([stdin],[],[],remaining)
    if not readable:
        return False
    provided=stdin.readline(32).strip().decode("ascii",errors="replace")
    return bool(re.fullmatch(r"[0-9]{6}",provided)) and hmac.compare_digest(provided,expected)

def main():
    require(os.geteuid()==0,"root_required")
    os.umask(0o077)
    identity=parse_identity(sys.stdin.buffer.readline(513))
    env=checked_env()
    node_step("preflight",identity,env["DATABASE_URL"])
    code=f"{secrets.randbelow(1000000):06d}"
    mail_otp(identity["email"],env,code)
    issued_at=time.monotonic()
    print("owner_bootstrap=OTP_SENT",flush=True)
    require(otp_matches(sys.stdin.buffer,code,issued_at),"invalid_or_expired_otp")
    node_step("create",identity,env["DATABASE_URL"])
    print("owner_bootstrap=PASS;email_verified=PASS",flush=True)

if __name__=="__main__":
    try:
        main()
    except Blocked as e:
        print("owner_bootstrap=BLOCKED;reason="+str(e),file=sys.stderr,flush=True)
        sys.exit(2)
    except Exception:
        print("owner_bootstrap=BLOCKED;reason=operation_failed",file=sys.stderr,flush=True)
        sys.exit(2)
