"""A stand-in for yt-dlp, for situations that cannot be caused for real: a hang, garbage output, a bot check, an update.
Behaviour comes from the FAKE_MODE environment variable."""
import os
import sys
import time

mode = os.environ.get("FAKE_MODE", "")
args = sys.argv[1:]
if "--version" in args:
    print(os.environ.get("FAKE_VERSION", "2099.01.01"))
    sys.exit(0)
if mode == "hang":
    time.sleep(600)
elif mode == "garbage":
    print("this is not json")
elif mode == "empty":
    pass
elif mode == "botcheck":
    print("ERROR: [youtube] abc123: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.", file=sys.stderr)
    sys.exit(1)
elif mode == "update-pip":
    print("ERROR: You installed yt-dlp with pip or using a package manager; Use that to update", file=sys.stderr)
    sys.exit(1)
elif mode == "spawn-children":  # leaves a child process behind unless the whole process group is killed
    import subprocess
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])
    with open(os.environ["FAKE_PIDFILE"], "w") as fh:
        fh.write(str(child.pid))
    time.sleep(600)
else:
    print("{}")
