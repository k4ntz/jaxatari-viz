import urllib.request
import re
import json
from pathlib import Path

GAMES = [
    "adventure", "air_raid", "alien", "amidar", "assault", "asterix", "asteroids",
    "atlantis", "bank_heist", "battle_zone", "beam_rider", "berzerk", "bowling",
    "boxing", "breakout", "centipede", "chopper_command", "crazy_climber", "defender",
    "demon_attack", "double_dunk", "enduro", "fishing_derby", "freeway", "frostbite",
    "gopher", "gravitar", "hero", "ice_hockey", "jamesbond", "kangaroo", "krull",
    "kung_fu_master", "montezuma_revenge", "ms_pacman", "name_this_game", "phoenix",
    "pitfall", "pong", "private_eye", "qbert", "riverraid", "road_runner", "robotank",
    "seaquest", "skiing", "solaris", "space_invaders", "star_gunner", "surround",
    "tennis", "time_pilot", "tutankham", "up_n_down", "venture", "video_pinball",
    "wizard_of_wor", "yars_revenge", "zaxxon", "donkey_kong", "flag_capture",
    "haunted_house", "pacman"
]

def scrape():
    summaries = {}
    print("Scraping Farama ALE documentation for environment summaries...")
    for game in GAMES:
        url = f"https://ale.farama.org/environments/{game}/"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            html = urllib.request.urlopen(req).read().decode('utf-8')
            m = re.search(r'Description.*?</h2>(.*?)<h2', html, re.DOTALL)
            if m:
                text = re.sub(r'<[^>]+>', ' ', m.group(1))
                text = re.sub(r'\s+', ' ', text).strip()
                # Clean up "For a more detailed documentation..."
                text = re.sub(r'For a more detailed documentation.*$', '', text).strip()
                summaries[game] = {
                    "summary": text,
                    "farama_url": url
                }
                print(f"✓ {game}")
            else:
                summaries[game] = {
                    "summary": f"{game.replace('_', ' ').title()} is an Atari 2600 environment supported in Gymnasium ALE and JAXAtari.",
                    "farama_url": url
                }
                print(f"~ {game} (fallback)")
        except Exception as e:
            summaries[game] = {
                "summary": f"{game.replace('_', ' ').title()} is an Atari 2600 environment supported in Gymnasium ALE and JAXAtari.",
                "farama_url": url
            }
            print(f"✗ {game}: {e}")

    out_file = Path(__file__).parent / "env_summaries.json"
    with open(out_file, "w") as f:
        json.dump(summaries, f, indent=2)
    print(f"Saved {len(summaries)} summaries to {out_file}")

if __name__ == "__main__":
    scrape()
