#!/usr/bin/env python3
import json, os, subprocess, time, urllib.request
from pathlib import Path
REPO=os.getenv("QA_GITHUB_REPO","shironaki/Ai"); ISSUE=int(os.getenv("QA_ISSUE","27"))
MARKER="<!-- QA-AGENT-CONTROL -->"; RESULT="<!-- QA-AGENT-RESULT -->"; USER=os.getenv("QA_CONTROL_USER","shironaki")
ROOT=Path(os.getenv("BOT_REPO_DIR",Path(__file__).resolve().parents[1])); TOKEN_FILE=Path(os.getenv("TERMUX_TOKEN_FILE","~/.config/ai/termux.env")).expanduser()
STATE=ROOT/"data/test/runtime/qa-agent-state.json"; SCENARIOS=ROOT/"qa/scenarios.json"
QA_PYTHON=Path(os.getenv("QA_PYTHON",str(Path.home()/"Ai/qa_client/.venv/bin/python"))); SESSION=Path(os.getenv("QA_SESSION",str(Path.home()/".config/ai/qa_client/founder_qa.session"))).expanduser()
API_ID=os.getenv("QA_API_ID","36412572"); TARGET=os.getenv("QA_TARGET","AiAether1_Bot")
def api_hash():
    v=os.getenv("QA_API_HASH","").strip()
    if v: return v
    d=SESSION.parent
    try:
        for p in d.rglob("*"):
            if p.is_file() and p.stat().st_size < 10000:
                for line in p.read_text(errors="ignore").splitlines():
                    if line.strip().lower().startswith(("api_hash=","api_hash =")):
                        return line.split("=",1)[1].strip().strip("'").strip('"')
    except OSError: pass
    return ""
def token():
    for n in ("TERMUX_GITHUB_TOKEN","GITHUB_TOKEN","GH_TOKEN"):
        if os.getenv(n,"").strip(): return os.getenv(n).strip()
    try:
        for x in TOKEN_FILE.read_text().splitlines():
            if x.startswith("TERMUX_GITHUB_TOKEN="): return x.split("=",1)[1].strip().strip("'").strip('"')
    except OSError: pass
    try: return subprocess.check_output(["gh","auth","token"],text=True,stderr=subprocess.DEVNULL,timeout=5).strip()
    except Exception: return ""
def gh(method,path,value=None):
    req=urllib.request.Request("https://api.github.com/repos/"+REPO+path,data=None if value is None else json.dumps(value,ensure_ascii=False).encode(),method=method,headers={"Accept":"application/vnd.github+json","Authorization":"Bearer "+token(),"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=15) as r: return json.loads(r.read().decode())
def comments():
    out=[]
    for p in range(1,11):
        x=gh("GET",f"/issues/{ISSUE}/comments?per_page=100&page={p}")
        if not x: break
        out+=x
        if len(x)<100: break
    return out
def state():
    try: return int(json.loads(STATE.read_text())["last_comment_id"])
    except Exception: return 0
def save(i):
    STATE.parent.mkdir(parents=True,exist_ok=True); STATE.write_text(json.dumps({"last_comment_id":i}))
def publish(s): gh("POST",f"/issues/{ISSUE}/comments",{"body":RESULT+"\n"+s})
def run(name):
    steps=json.loads(SCENARIOS.read_text())[name]
    code='''import asyncio,json,os,time
from telethon import TelegramClient
async def main():
 c=TelegramClient(os.path.expanduser(os.environ["QA_SESSION"]),int(os.environ["QA_API_ID"]),os.environ["QA_API_HASH"]); await c.start()
 e=await c.get_entity(os.environ["QA_TARGET"]); out=[]
 for s in json.loads(os.environ["QA_STEPS"]):
  t=int(time.time()); await c.send_message(e,s["text"]); deadline=time.time()+s.get("wait",10); rr=[]
  while time.time()<deadline:
   async for m in c.iter_messages(e,limit=20):
    if not m.out and m.message and int(m.date.timestamp())>=t-1: rr.append({"id":m.id,"text":m.message})
   if rr: break
   await asyncio.sleep(1)
  out.append({"sent":s["text"],"replies":rr[:8]})
 await c.disconnect(); print(json.dumps(out,ensure_ascii=False))
asyncio.run(main())'''
    env=os.environ.copy(); env.update(QA_API_ID=API_ID,QA_API_HASH=api_hash(),QA_SESSION=str(SESSION),QA_TARGET=TARGET,QA_STEPS=json.dumps(steps,ensure_ascii=False))
    p=subprocess.run([str(QA_PYTHON),"-c",code],cwd=ROOT,env=env,text=True,capture_output=True,timeout=240)
    if p.returncode: raise RuntimeError((p.stderr or p.stdout)[-2000:])
    return json.loads(p.stdout)
def command(cmd):
    p=cmd.split(maxsplit=1); op=p[0].upper()
    if op=="STATUS": return f"QA_AGENT ONLINE; python={QA_PYTHON}; session={'present' if SESSION.exists() else 'missing'}; target={TARGET}"
    if op=="RUN":
        name=p[1].strip().lower() if len(p)>1 else "smoke"; names=list(json.loads(SCENARIOS.read_text())) if name=="all" else [name]; r=[]
        for n in names:
            try: r.append({"scenario":n,"ok":True,"results":run(n)})
            except Exception as e: r.append({"scenario":n,"ok":False,"error":f"{type(e).__name__}: {e}"})
        return "QA REPORT\n"+json.dumps(r,ensure_ascii=False,indent=2)
    return "ignored command: "+cmd
last=state()
while True:
    try:
        for c in comments():
            i=int(c["id"])
            if i<=last or c.get("user",{}).get("login")!=USER or MARKER not in c.get("body",""): continue
            last=i; save(i)
            try: publish(command(c["body"].replace(MARKER,"").strip()))
            except Exception as e: publish(f"QA ERROR: {type(e).__name__}: {e}")
    except Exception: pass
    time.sleep(8)
