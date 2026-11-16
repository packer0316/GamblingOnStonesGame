"""Builds the game's sound effects (public/sfx) from CC0 source recordings.

    python -I tools/sfx_build.py              # everything
    python -I tools/sfx_build.py saw_cut ...  # only the named sounds

Sources are fetched once into .sfx-cache/ (not in git): Freesound HQ previews by id,
and Kenney packs as their zip files (read straight out of the zip). Every source is
CC0 1.0; CREDITS.txt in public/sfx lists them anyway.

Each entry says where a sound comes from and how it is cut and mixed:
    layer = dict(src, start, end, gain, delay, rate, lp, hp)
      src    'fs:<id>' (Freesound) or 'k:<pack>/<name>' (Kenney .ogg inside the zip)
      start, end   seconds into the source (end None = to the end)
      rate   playback speed: 0.88 is 12% slower and lower, 1.25 is faster and higher
      lp, hp low-pass / high-pass corner in Hz (distance, felt, a smaller tool)
One-shots are loudness-matched and written as mono MP3. Loops are made seamless with
an equal-power crossfade and written as WAV (MP3 pads its start and end with silence,
which would leave a gap every time a loop wraps).

Needs ffmpeg on PATH, numpy and scipy.
"""
import io, json, os, subprocess, sys, urllib.request, zipfile
from fractions import Fraction
import numpy as np
from scipy import signal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'sfx')
CACHE = os.path.join(ROOT, '.sfx-cache')
UA = 'Mozilla/5.0 (game-sfx-tool)'
SR = 44100

# Kenney (kenney.nl), CC0
KENNEY = {
    'impact': 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
    'rpg': 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
    'interface': 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
    'digital': 'https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip',
    'scifi': 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip',
    'jingles': 'https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip',
}
KENNEY_NAMES = {'impact': 'Impact Sounds', 'rpg': 'RPG Audio', 'interface': 'Interface Sounds', 'digital': 'Digital Audio',
                'scifi': 'Sci-Fi Sounds', 'jingles': 'Music Jingles'}

# Freesound (freesound.org), all CC0: id -> (HQ preview, author, title)
FREESOUND = {
    # stones on the bench
    '558254': ('https://cdn.freesound.org/previews/558/558254_10531612-hq.mp3', 'msavioti', 'Heavy Stone Push'),
    '364709': ('https://cdn.freesound.org/previews/364/364709_2531187-hq.mp3', 'alegemaate', 'Rock on Rock Scrape'),
    '743262': ('https://cdn.freesound.org/previews/743/743262_71257-hq.mp3', 'qubodup', 'Stone Sliding'),
    '19291': ('https://cdn.freesound.org/previews/19/19291_84709-hq.mp3', 'martian', 'foley cloth rustle.wav'),
    '428337': ('https://cdn.freesound.org/previews/428/428337_8617763-hq.mp3', 'zembacraftworks', 'Canvas Dropcloth Snap 1'),
    # money
    '161315': ('https://cdn.freesound.org/previews/161/161315_2840087-hq.mp3', 'husky70', 'Counting Me Shillings.mp3'),
    '178097': ('https://cdn.freesound.org/previews/178/178097_3301290-hq.mp3', 'madvedj', 'banknote-counter.wav'),
    '595041': ('https://cdn.freesound.org/previews/595/595041_12672200-hq.mp3', '21100354', 'money counter.wav'),
    '611113': ('https://cdn.freesound.org/previews/611/611113_1629501-hq.mp3', '5ro4', 'bell ding 1.wav'),
    '334969': ('https://cdn.freesound.org/previews/334/334969_5058825-hq.mp3', 'dominictreis', 'Many Coins Dumped on a Wooden Surface.mp3'),
    # torch and lamp
    '187335': ('https://cdn.freesound.org/previews/187/187335_3297044-hq.mp3', 'baidonovan', 'Flashlight Clicking On.wav'),
    '457463': ('https://cdn.freesound.org/previews/457/457463_4921277-hq.mp3', 'Rudmer_Rotteveel', 'Small_Flashlight_Click_on_02.wav'),
    '440499': ('https://cdn.freesound.org/previews/440/440499_4629347-hq.mp3', 'ChrisTutorials', 'Light Switch Turn Off Sound'),
    '788643': ('https://cdn.freesound.org/previews/788/788643_11135759-hq.mp3', 'Philip_Berger', 'Light Switch on'),
    # grinder
    '449489': ('https://cdn.freesound.org/previews/449/449489_8667144-hq.mp3', 'rodrigocswm', 'Dremel on off and increasing speed'),
    '339147': ('https://cdn.freesound.org/previews/339/339147_5931043-hq.mp3', 'Beethovenboy', 'Angle Grinder_Cutting Concrete'),
    '630484': ('https://cdn.freesound.org/previews/630/630484_10616645-hq.mp3', 'jimbo555', 'Bottle Squirt.wav'),
    '540972': ('https://cdn.freesound.org/previews/540/540972_11651516-hq.mp3', 'polyn', 'wipe and scrub.wav'),
    # saw
    '232136': ('https://cdn.freesound.org/previews/232/232136_3249786-hq.mp3', 'yottasounds', 'rolling cart 002.wav'),
    '386195': ('https://cdn.freesound.org/previews/386/386195_1655965-hq.mp3', 'ldezem', 'Leg vise - Slide'),
    '386197': ('https://cdn.freesound.org/previews/386/386197_1655965-hq.mp3', 'ldezem', 'Leg vise - Hit'),
    '835550': ('https://cdn.freesound.org/previews/835/835550_18079032-hq.mp3', 'Autobot8299', 'Industrial Lever'),
    '516608': ('https://cdn.freesound.org/previews/516/516608_3874107-hq.mp3', 'jameswrowles', 'Chop Saw'),
    '212177': ('https://cdn.freesound.org/previews/212/212177_140737-hq.mp3', 'OwlStorm', 'Tap Water 1'),
    '173938': ('https://cdn.freesound.org/previews/173/173938_3229685-hq.mp3', 'JohnsonBrandEditing', 'Pour Splash metal bucket water.mp3'),
    # the reveal
    '688735': ('https://cdn.freesound.org/previews/688/688735_10403690-hq.mp3', 'Cloud-10', 'Heartbeat 97 BPM'),
    '109360': ('https://cdn.freesound.org/previews/109/109360_1868848-hq.mp3', 'SoundCollectah', 'stone falls and breaks low pitch.aiff'),
    '18654': ('https://cdn.freesound.org/previews/18/18654_4494-hq.mp3', 'nkuitse', 'gong.aiff'),
    '76886': ('https://cdn.freesound.org/previews/76/76886_1051883-hq.mp3', 'airtaxi', 'Gong.wav'),
    '121557': ('https://cdn.freesound.org/previews/121/121557_1305809-hq.mp3', 'sbarncar', 'firecrackers.wav'),
    '221568': ('https://cdn.freesound.org/previews/221/221568_1282865-hq.mp3', 'AlaskaRobotics', 'cheering and clapping crowd 1'),
    '462362': ('https://cdn.freesound.org/previews/462/462362_9159316-hq.mp3', 'Breviceps', 'Small applause'),
    '264499': ('https://cdn.freesound.org/previews/264/264499_3890365-hq.mp3', 'noah0189', 'Crowd Ooohs and Ahhhs in Excitement'),
    '324896': ('https://cdn.freesound.org/previews/324/324896_2104797-hq.mp3', 'deleted_user_2104797', 'Crowd aah.wav'),
    '619007': ('https://cdn.freesound.org/previews/619/619007_781461-hq.mp3', 'mrrap4food', 'crowd `oh - - disappointed.mp3'),
    '324897': ('https://cdn.freesound.org/previews/324/324897_2104797-hq.mp3', 'deleted_user_2104797', 'Crowd Ouch.wav'),
    # the hall at night
    '522299': ('https://cdn.freesound.org/previews/522/522299_9084007-hq.mp3', 'Defelozedd94', 'Crickets At Night - Raw sound'),
    '640254': ('https://cdn.freesound.org/previews/640/640254_3562198-hq.mp3', 'gecop', 'geroezemoes.wav'),
    '444521': ('https://cdn.freesound.org/previews/444/444521_938246-hq.mp3', 'nomadas', 'Ambience at a Chinese restaurant street'),
    # interface
    '422513': ('https://cdn.freesound.org/previews/422/422513_3302499-hq.mp3', 'Nightflame', 'Swinging staff whoosh (strong) 04.wav'),
    # cloth: hover, click and stones set down on the felt (no pitched blips anywhere)
    '19290': ('https://cdn.freesound.org/previews/19/19290_84709-hq.mp3', 'martian', 'clothxtra foley flap.wav'),
    '272428': ('https://cdn.freesound.org/previews/272/272428_5163890-hq.mp3', 'ryanharding95', 'Closing a Paper Fan.wav'),
    # the torch's metal head ticking on the stone as it slides
    '875428': ('https://cdn.freesound.org/previews/875/875428_16682330-hq.mp3', 'loganzsound', 'Marble Coaster Hard Clicks'),
    '483405': ('https://cdn.freesound.org/previews/483/483405_4807538-hq.mp3', 'vintage2005', 'Brick fall on carpet -3db.aiff'),
    '438988': ('https://cdn.freesound.org/previews/438/438988_4807538-hq.mp3', 'vintage2005', 'Large duffel bag drop'),
    # the player leaning in to look at a stone, and sitting back
    '399586': ('https://cdn.freesound.org/previews/399/399586_7673339-hq.mp3', 'WolffVisuals', 'jacket'),
    '429080': ('https://cdn.freesound.org/previews/429/429080_4437257-hq.mp3', 'leonelmail', 'Shirt Clothing Movement'),
    '320144': ('https://cdn.freesound.org/previews/320/320144_140737-hq.mp3', 'OwlStorm', 'Blanket Movement 6'),
    # verdict percussion: a Chinese bass drum (dagu) and an opera cymbal, struck once, never a tune
    '856549': ('https://cdn.freesound.org/previews/856/856549_17110092-hq.mp3', 'sazanami12', 'Chinese Bass Drum Dagu - Center Stroke on Drumhead - Loud'),
    '856550': ('https://cdn.freesound.org/previews/856/856550_17110092-hq.mp3', 'sazanami12', 'Chinese Bass Drum Dagu - Center Stroke on Drumhead - Soft'),
    '856559': ('https://cdn.freesound.org/previews/856/856559_17110092-hq.mp3', 'sazanami12', 'Chinese Bass Drum Dagu - Rim Shot from Both Sides - Loud'),
    '856560': ('https://cdn.freesound.org/previews/856/856560_17110092-hq.mp3', 'sazanami12', 'Chinese Bass Drum Dagu - Rim Shot from Both Sides - Soft'),
    '452400': ('https://cdn.freesound.org/previews/452/452400_612689-hq.mp3', 'kyles', 'cymbal splash hit nearby chinese opera in park.flac'),
}


def L(src, start=0.0, end=None, gain=1.0, delay=0.0, rate=1.0, lp=None, hp=None):
    return dict(src=src, start=start, end=end, gain=gain, delay=delay, rate=rate, lp=lp, hp=hp)


# name -> (layers, fade-in, fade-out)
SOUNDS = {
    # ---- interface
    # hover and click are cloth, not tones: a short flick of fabric, and a padded slap with a low body under it
    # a paper fan snapping shut: crisp, nothing below 300 Hz (a padded cloth slap still read as a drum)
    'ui_click': ([L('fs:272428', 0.15, 0.30, hp=300, lp=9000)], 0.003, 0.08),
    # the torch's head ticking on the skin as it slides: hard clicks on marble, five takes
    'torch_tap_1': ([L('fs:875428', 0.060, 0.16, hp=400, lp=8000)], 0.002, 0.05),
    'torch_tap_2': ([L('fs:875428', 0.718, 0.80, hp=400, lp=8000)], 0.002, 0.04),
    'torch_tap_3': ([L('fs:875428', 1.242, 1.34, hp=400, lp=8000)], 0.002, 0.05),
    'torch_tap_4': ([L('fs:875428', 1.741, 1.84, hp=400, lp=8000)], 0.002, 0.05),
    'torch_tap_5': ([L('fs:875428', 2.245, 2.34, hp=400, lp=8000)], 0.002, 0.05),
    # picking a stone is not a click: the player leans in over the felt (clothes rub), and sits back again
    'lean_in_1': ([L('fs:399586', 0.30, 1.25, hp=150, lp=5500)], 0.05, 0.15),
    'lean_in_2': ([L('fs:429080', 43.70, 44.45, hp=150, lp=5500)], 0.08, 0.15),
    'lean_out': ([L('fs:320144', 0.15, 0.80, hp=150, lp=5500)], 0.05, 0.2),
    'ui_hover_1': ([L('fs:19290', 0.06, 0.30, hp=150, lp=6000)], 0.01, 0.12),
    'ui_hover_2': ([L('fs:19290', 0.615, 0.84, hp=150, lp=6000)], 0.01, 0.12),
    'ui_hover_3': ([L('fs:19290', 0.875, 1.10, hp=150, lp=6000)], 0.01, 0.12),
    'deny': ([L('k:interface/error_006')], 0, 0),
    'whoosh': ([L('fs:422513', 0, 0.31)], 0, 0.05),
    # ---- stones on the felt: rock on wood, the felt takes the top off, a soft thump under it
    # a stone set down on the felt: a bag-of-cloth "fump" over a dull landing on something soft. The
    # landing's boom below 160 Hz is cut away: with it, a stone set down sounded like a drum.
    'stone_down_1': ([L('fs:483405', 0.005, 0.28, hp=160), L('fs:438988', 1.07, 1.40, 0.75, hp=120, lp=4000)], 0, 0.1),
    'stone_down_2': ([L('fs:483405', 0.395, 0.62, hp=160), L('fs:438988', 1.07, 1.40, 0.75, hp=120, lp=4000)], 0, 0.1),
    'stone_down_3': ([L('fs:483405', 0.005, 0.28, rate=0.92, hp=160), L('fs:438988', 1.07, 1.40, 0.8, hp=120, lp=4000)], 0, 0.1),
    'stone_slide': ([L('fs:558254', 0, 1.0, lp=7000)], 0.02, 0.3),  # the two halves eased apart
    'stone_clack': ([L('fs:364709', 0, None), L('k:impact/impactMining_000', 0, None, 0.5)], 0, 0.06),  # halves knock as they part
    'stone_lift': ([L('fs:743262', 0, None, 0.8, lp=6000)], 0, 0.06),  # picked up off the cloth
    'cloth_rustle': ([L('fs:19291', 0.4, 1.9)], 0.05, 0.35),  # the vendor's cloth as stones are laid out
    'cloth_snap': ([L('fs:428337', 0, 0.8)], 0, 0.15),
    # ---- money
    'pay_notes': ([L('fs:161315', 0.43, 1.5)], 0.01, 0.15),  # a few notes counted onto the counter
    'count_notes': ([L('fs:178097', 0, 3.1)], 0.02, 0.25),  # banknote counter riffling the payout
    'count_end': ([L('fs:595041', 2.55, 3.45)], 0.03, 0.1),  # the counter running down and beeping
    'cash_ding': ([L('fs:611113', 0, 2.5)], 0, 0.8),
    'coins_1': ([L('k:rpg/handleCoins', 0.04)], 0, 0),
    'coins_2': ([L('k:rpg/handleCoins2')], 0, 0),
    'coins_shower': ([L('fs:334969', 0.2, 5.6)], 0.02, 1.2),
    # ---- torch and the lamp over the bench
    'torch_on': ([L('fs:187335', 0, 0.5)], 0, 0.05),
    'torch_off': ([L('fs:457463', 0.09)], 0, 0.03),
    'lamp_off': ([L('fs:440499', 0.08)], 0, 0.05),
    'lamp_on': ([L('fs:788643')], 0, 0.04),
    # ---- grinder: flexible-shaft motor, the burr biting stone, water and a wipe
    'grinder_start': ([L('fs:449489', 7.55, 9.3)], 0, 0.12),
    'grinder_stop': ([L('fs:449489', 5.0, 7.0)], 0.04, 0.45),
    'squirt': ([L('fs:630484', 0, 0.8)], 0, 0.1),
    'wipe': ([L('fs:540972', 0.3, 1.35)], 0.02, 0.2),
    # ---- saw: machine run up, vise, motor, blade in stone, coolant
    'machine_roll': ([L('fs:232136', 0.3, 1.8, rate=0.85)], 0.15, 0.4),
    'vise_close': ([L('fs:386195', 0, 0.45), L('fs:386197', 0.15, 0.75, 1.0, 0.32)], 0, 0.12),
    'vise_open': ([L('fs:835550', 0, 0.8, 0.9), L('fs:386195', 0.3, 0.75, 0.8, 0.1)], 0, 0.15),
    'saw_start': ([L('fs:516608', 0, 2.4)], 0, 0.15),
    'saw_stop': ([L('fs:516608', 14.7, 17.0)], 0.04, 0.5),
    # ---- washing the faces
    'pour_1': ([L('fs:173938', 0.35, 3.3)], 0.02, 0.6),
    'pour_2': ([L('fs:173938', 4.75, 7.9)], 0.02, 0.6),
    # ---- the reveal
    'heartbeat': ([L('fs:688735', 0, 0.62)], 0, 0.06),
    'crack_sting': ([L('fs:109360', 0.1, 0.75)], 0, 0.25),  # a crack turns up in the face
    'gong_big': ([L('fs:18654', 0, None)], 0, 1.5),
    'gong_small': ([L('fs:76886', 0.85, 5.8)], 0, 1.5),
    'firecrackers': ([L('fs:121557', 0.15, 4.2)], 0, 0.8),
    'crowd_cheer': ([L('fs:221568', 0.5, 6.0)], 0.05, 1.5),
    'applause': ([L('fs:462362', 0, 3.6)], 0, 1.0),
    'crowd_ooh': ([L('fs:264499', 6.0, 8.3)], 0.02, 0.5),
    'crowd_ooh_big': ([L('fs:264499', 11.3, 13.9)], 0.02, 0.6),
    'crowd_aah': ([L('fs:324896', 0.7, 4.0)], 0.05, 0.8),
    'crowd_oh': ([L('fs:619007', 0.3, 2.6)], 0.02, 0.4),
    'crowd_ouch': ([L('fs:324897', 0.9, 5.2)], 0.02, 0.8),
    # the verdict under the crowd: one stroke of drum and cymbal (the jingles they replace were tunes)
    'luogu_up': ([L('fs:452400', 0.0, 0.9), L('fs:856559', 0.255, 0.95, 0.7)], 0, 0.3),       # rim and cymbal together: "chang!"
    'luogu_flat': ([L('fs:856560', 0.25, 0.75, lp=5000)], 0, 0.2),                             # a dry knock on the rim
    'luogu_down': ([L('fs:856550', 0.245, 1.7), L('fs:856560', 0.25, 0.7, 0.3)], 0, 0.5),       # the drum's centre, soft: "dong"
    'luogu_crash': ([L('fs:856549', 0.255, 2.2), L('fs:856559', 0.255, 0.8, 0.35)], 0, 0.8),    # the centre, hard
    'boom': ([L('k:scifi/lowFrequency_explosion_000')], 0, 0),
}

# name -> (layers, crossfade seconds, sample rate, target RMS dB)
LOOPS = {
    'amb_crickets': ([L('fs:522299', 60.0, 78.0, hp=900)], 1.5, 22050, -22),
    'amb_murmur': ([L('fs:640254', 30.0, 54.0, lp=2800), L('fs:444521', 22.0, 46.0, 0.6, lp=2200)], 2.0, 22050, -22),
    'grinder_loop': ([L('fs:449489', 31.0, 37.0)], 0.5, 32000, -18),
    'grinder_bite': ([L('fs:339147', 51.0, 57.5, rate=1.25)], 0.5, 32000, -18),  # a small burr on stone: the concrete cut, higher
    'saw_idle': ([L('fs:516608', 3.0, 12.0)], 0.6, 32000, -18),
    'saw_cut': ([L('fs:339147', 72.5, 84.0, rate=0.88)], 0.6, 32000, -18),  # a 400 mm diamond blade in stone: lower, heavier
    'coolant': ([L('fs:212177', 3.0, 9.0)], 0.5, 22050, -20),
}


# ------------------------------------------------------------------ sources
def fetch(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r, open(path + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(path + '.part', path)


_zips = {}


def source_bytes(ref):
    kind, name = ref.split(':', 1)
    if kind == 'fs':
        path = os.path.join(CACHE, 'fs', f'{name}.mp3')
        if not os.path.exists(path):
            print(f'  fetching freesound {name}', flush=True)
            fetch(FREESOUND[name][0], path)
        return open(path, 'rb').read()
    pack, member = name.split('/', 1)
    if pack not in _zips:
        path = os.path.join(CACHE, 'kenney', f'{pack}.zip')
        if not os.path.exists(path):
            print(f'  fetching kenney {pack}', flush=True)
            fetch(KENNEY[pack], path)
        z = zipfile.ZipFile(path)
        _zips[pack] = {os.path.splitext(os.path.basename(n))[0]: n for n in z.namelist() if n.lower().endswith('.ogg')}, z
    index, z = _zips[pack]
    return z.read(index[member])


def decode(ref, sr):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
                         input=source_bytes(ref), capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


# ------------------------------------------------------------------ processing
def render_layer(layer, sr):
    x = decode(layer['src'], sr)
    a = int(round(layer['start'] * sr))
    b = len(x) if layer['end'] is None else min(len(x), int(round(layer['end'] * sr)))
    x = x[a:b]
    if layer['rate'] != 1.0:
        f = Fraction(layer['rate']).limit_denominator(64)  # faster = fewer samples
        x = signal.resample_poly(x, f.denominator, f.numerator)
    if layer['hp']:
        x = signal.sosfiltfilt(signal.butter(2, layer['hp'], 'highpass', fs=sr, output='sos'), x)
    if layer['lp']:
        x = signal.sosfiltfilt(signal.butter(2, layer['lp'], 'lowpass', fs=sr, output='sos'), x)
    return x


def loudest_rms(x, sr, win=0.05):
    n = max(1, int(win * sr))
    if len(x) <= n:
        return float(np.sqrt(np.mean(x ** 2)) + 1e-9)
    c = np.cumsum(np.concatenate([[0.0], x ** 2]))
    return float(np.sqrt((c[n:] - c[:-n]).max() / n) + 1e-9)


def match(x, sr, rms_db=-12.0, peak_db=-1.0):
    x = x * (10 ** (rms_db / 20) / loudest_rms(x, sr))
    peak = np.abs(x).max() + 1e-9
    limit = 10 ** (peak_db / 20)
    return x * (limit / peak) if peak > limit else x


def mix(layers, sr):
    parts = []
    for layer in layers:
        y = match(render_layer(layer, sr), sr) * layer['gain']  # layers meet at a common level
        parts.append(np.concatenate([np.zeros(int(layer['delay'] * sr)), y]))
    out = np.zeros(max(len(p) for p in parts))
    for p in parts:
        out[:len(p)] += p
    return out


def fade(x, sr, fin, fout):
    if fin > 0:
        n = min(len(x), int(fin * sr)); x[:n] *= np.linspace(0, 1, n) ** 2
    if fout > 0:
        n = min(len(x), int(fout * sr)); x[-n:] *= np.linspace(1, 0, n) ** 2
    n = min(len(x), 64)  # never a click at a cut
    x[:n] *= np.linspace(0, 1, n); x[-n:] *= np.linspace(1, 0, n)
    return x


def write_mp3(x, sr, path):
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', '96k', path], input=pcm, check=True)


def write_wav(x, sr, path):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-', path], input=pcm, check=True)


def build(only):
    os.makedirs(OUT, exist_ok=True)
    report = {}
    for name, (layers, fin, fout) in SOUNDS.items():
        if only and name not in only:
            continue
        x = match(fade(mix(layers, SR), SR, fin, fout), SR)
        write_mp3(x, SR, os.path.join(OUT, f'{name}.mp3'))
        report[name] = round(len(x) / SR, 2)
    for name, (layers, xf, sr, rms_db) in LOOPS.items():
        if only and name not in only:
            continue
        x = mix(layers, sr)
        n = int(xf * sr)
        t = np.linspace(0, np.pi / 2, n)
        body = x[:len(x) - n].copy()
        body[:n] = x[:n] * np.sin(t) + x[len(x) - n:] * np.cos(t)  # equal-power seam
        body *= 10 ** (rms_db / 20) / (np.sqrt(np.mean(body ** 2)) + 1e-9)
        peak = np.abs(body).max()
        if peak > 0.89:
            body *= 0.89 / peak
        write_wav(body, sr, os.path.join(OUT, f'{name}.wav'))
        report[name] = round(len(body) / sr, 2)
    write_credits()
    print(json.dumps(report))


def write_credits():
    def ids(layers):
        return [l['src'] for l in layers]
    used = set()
    for layers, *_ in list(SOUNDS.values()) + list(LOOPS.values()):
        used.update(ids(layers))
    packs = sorted({u.split(':')[1].split('/')[0] for u in used if u.startswith('k:')})
    lines = ['Sound effects of 一刀窮一刀富 — every source is CC0 1.0 (public domain); no attribution is required.',
             'They are cut, layered and loudness-matched by tools/sfx_build.py.', '',
             'Kenney (kenney.nl), CC0: ' + ', '.join(KENNEY_NAMES[p] for p in packs) + '.', '', 'Freesound (freesound.org), CC0:']
    for sid in sorted({u.split(':')[1] for u in used if u.startswith('fs:')}, key=int):
        _, who, title = FREESOUND[sid]
        lines.append(f'  {sid:>7}  {title} — {who}  https://freesound.org/s/{sid}/')
    with open(os.path.join(OUT, 'CREDITS.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    build(set(sys.argv[1:]))
