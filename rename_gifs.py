import json
import shutil
from pathlib import Path
import os

gifs_dir = Path("/Users/kantoz/Research/JAXAtari/docs/source/_static/gifs")
out_dir = Path("frontend/public/api/environments/gif")
out_dir.mkdir(parents=True, exist_ok=True)

with open("frontend/public/api/environments.json") as f:
    envs = json.load(f)["environments"]

available_gifs = [g for g in os.listdir(gifs_dir) if g.endswith(".gif")]

for env in envs:
    if env["has_gif"]:
        env_id = env["id"]
        normalized = env_id.replace("_", "").lower()
        if normalized == "montezumarevenge":
            normalized = "montezuma"
        elif normalized == "mspacman":
            normalized = "mspacman"
            
        for g in available_gifs:
            gif_name = g.replace(".gif", "").replace("_", "").lower()
            if gif_name == normalized or normalized in gif_name or gif_name in normalized:
                shutil.copy(gifs_dir / g, out_dir / f"{env_id}.gif")
                # update json
                env["gif_url"] = f"api/environments/gif/{env_id}.gif"
                break

with open("frontend/public/api/environments.json", "w") as f:
    json.dump({"environments": envs}, f)
