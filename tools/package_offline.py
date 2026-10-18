"""Build self-contained solo game and the Cloudflare multiplayer deployment zip."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
out = root.parent
css = (root / 'public/country/styles.css').read_text()
questions = (root / 'public/country/questions.js').read_text()
app = (root / 'public/country/app.js').read_text()
picker = (root / 'public/country/picker.js').read_text()
solo = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e1820">
<meta name="description" content="90s country trivia with answer-reveal lyric excerpts. Play offline on your phone.">
<title>Honky Tonk Showdown — Offline Solo Quiz</title>
<style>
''' + css + '''
</style>
</head>
<body>
<div class="backdrop" aria-hidden="true"><div class="disc"></div></div>
<main id="app" class="app"><noscript>Enable JavaScript to play the quiz.</noscript></main>
<footer class="footnote">BUILT FOR FOLKS WHO KNOW EVERY WORD &nbsp; · &nbsp; STRICTLY 1990–1999 COUNTRY</footer>
<script>
window.ONLY_SOLO = true;
''' + questions + '\n' + picker + '\n' + app + '''
</script>
</body>
</html>
'''
(out / 'Honky_Tonk_Showdown_Solo.html').write_text(solo)

with ZipFile(out / 'Honky_Tonk_Showdown_Multiplayer.zip', 'w', ZIP_DEFLATED) as z:
    for path in sorted(root.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts or path.name.startswith('.'):
            continue
        z.write(path, Path(root.name) / path.relative_to(root))
print('Saved', out / 'Honky_Tonk_Showdown_Solo.html')
print('Saved', out / 'Honky_Tonk_Showdown_Multiplayer.zip')
