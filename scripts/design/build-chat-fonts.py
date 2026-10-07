"""Pin the reviewed Mona Sans axes for native use; retain OFL and rename derivatives.

Run with fontTools installed in an isolated tool environment, not the app:
  python build-chat-fonts.py /path/to/review/assets/MonaSans.ttf
"""
from pathlib import Path
import hashlib
import json
import shutil
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE_SHA = 'ade8e0e711f2798266e12f02b271aba1c345c5a38be4e98cb72d198248ccc8a7'
source = Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest() == SOURCE_SHA, 'Unexpected source font'
output = Path(__file__).resolve().parents[2] / 'assets/fonts/afterglow'
output.mkdir(parents=True, exist_ok=True)
specs = [
    ('WashedUpUI-Regular', 400, 100, 24),
    ('WashedUpUI-Medium', 580, 100, 24),
    ('WashedUpUI-Semibold', 680, 100, 24),
    ('WashedUpDisplay-Semibold', 750, 93, 100),
]
manifest = {'source': 'github/mona-sans v2.0.27', 'sourceSha256': SOURCE_SHA, 'fonts': []}
for name, weight, width, optical in specs:
    axes = {'wght': weight, 'wdth': width, 'opsz': optical, 'ital': 0}
    original = TTFont(source, recalcTimestamp=False)
    result = instantiateVariableFont(original, axes, inplace=True)
    assert 'fvar' not in result, 'Native assets must be static'
    # OFL reserves Mona Sans. These derived instances use distinct primary names.
    names = result['name']
    replacements = {
        1: name, 2: 'Regular', 3: f'2.027;WashedUpReview;{name}',
        4: name, 6: name, 16: name, 17: 'Regular',
        10: 'Local WashedUp redesign instance derived from Mona Sans VF 2.027. '
            'Original font by GitHub and Deni Anggara; no endorsement implied.',
    }
    for name_id in set(replacements) | {21, 22, 25}:
        names.removeNames(nameID=name_id)
    for name_id, value in replacements.items():
        names.setName(value, name_id, 3, 1, 0x409)
    # Each file is addressed by its distinct PostScript/family name at runtime.
    result['OS/2'].usWeightClass = weight
    result['OS/2'].fsSelection = (result['OS/2'].fsSelection & ~((1 << 0) | (1 << 5))) | (1 << 6)
    result['head'].macStyle &= ~3
    target = output / f'{name}.ttf'
    result.save(target)
    check = TTFont(target)
    assert check['name'].getDebugName(6) == name
    assert 'fvar' not in check
    assert check.getBestCmap() == original.getBestCmap()
    manifest['fonts'].append({'file': target.name, 'axes': axes, 'bytes': target.stat().st_size,
                             'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
shutil.copyfile(source.with_name('MonaSans-OFL.txt'), output / 'OFL.txt')
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
