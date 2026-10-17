"""Rebuild identical solo/client and authoritative multiplayer/server question banks.

The original 53 are stored in base_questions.json. The expansion is curated in
extra_hits.py. Every new song gets one question and a short chorus-hook excerpt.
"""
from pathlib import Path
import json,random,re,unicodedata
from extra_hits import HITS,HOOKS
from extra_details import DETAILS
DATA_DIR = Path(__file__).resolve().parent
ROOT = DATA_DIR.parents[1]
base = json.loads((DATA_DIR / 'base_questions.json').read_text())

OMIT={
    # Outside 1990–1999, or questionable as a 90s hit
    ('Tracy Byrd','Ten Rounds with Jose Cuervo'),
    ('Aaron Tippin','Kiss This'),
    ('Randy Travis','Forever and Ever, Amen'),
    ('Ricky Van Shelton','I’ll Leave This World Loving You'),
    ('Ricky Van Shelton','Rockin’ Years'), # a duet; avoid mis-crediting
    ('Keith Whitley','I’m No Stranger to the Rain'),
    ('Restless Heart','Big Dreams in a Small Town'),
    ('Restless Heart','A Tender Lie'),
    ('Shenandoah','The Church on Cumberland Road'),
    ('Shenandoah','Two Dozen Roses'),
    ('Sawyer Brown','The Race Is On'),
    ('John Michael Montgomery','The Little Girl'),
    ('Clint Black','When I Said I Do'), # duet with Lisa Hartman Black
    ('Clint Black','Walkin’ Away'), # shared title with Diamond Rio 1996 hit
    ('Vince Gill','When I Call Your Name'), # 1989 recording; borderline
    ('Randy Travis','Heroes and Friends'), # multiple artist recordings; avoid ambiguity
    ('The Mavericks','O What a Thrill'), # potential year ambiguity
    ('Randy Travis','If I Didn’t Have You'), # same title performed by other acts
    ('John Michael Montgomery','I Swear'), # 90s pop cover by All-4-One; country correct but source okay if explicitly country
}
# A few titles are not a lyric quote as written, so provide the short actual refrain instead.
HOOKS.update({
    'Two of a Kind, Workin’ on a Full House': 'workin’ on a full house',
    'Ain’t Going Down (’Til the Sun Comes Up)': 'ain’t goin’ down',
    'Rock My World (Little Country Girl)': 'rock my world, little country girl',
    'If You’re Not in It for Love (I’m Outta Here!)': 'I’m outta here',
    'The Woman in Me (Needs the Man in You)': 'the woman in me',
    'Don’t Be Stupid (You Know I Love You)': 'don’t be stupid',
    'XXX’s and OOO’s (An American Girl)': 'X’s and O’s',
    'A Girl’s Gotta Do (What a Girl’s Gotta Do)': 'a girl’s gotta do',
    'One Way Ticket (Because I Can)': 'one way ticket',
    'A Jukebox with a Country Song': 'a jukebox with a country song',
    'I’d Be Better Off (In a Pine Box)': 'I’d be better off',
    'That’s as Close as I’ll Get to Loving You': 'that’s as close as I’ll get',
    'I’ve Cried My Last Tear for You': 'cried my last tear for you',
    'The Day That She Left Tulsa (In a Chevy)': 'the day that she left Tulsa',
    'She’s Got It All': 'she’s got it all',
    'Somewhere Other Than the Night': 'somewhere other than the night',
    'The Greatest Man I Never Knew': 'the greatest man I never knew',
    'Here’s a Quarter (Call Someone Who Cares)': 'here’s a quarter',
    'In the Heart of a Woman': 'in the heart of a woman',
    'The Night the Lights Went Out in Georgia': 'the night the lights went out in Georgia',
    'You Can Feel Bad': 'you can feel bad',
})

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFKD',s.casefold()) if c.isalnum())

# One recording per match, even when its song has multiple lyric-detail questions.
for original in base:
    original['topic'] = 'hit-' + norm(original['lyricSong'].split(' (from ')[0])
orig_song_names={norm(x['lyricSong'].split(' (from ')[0]) for x in base}
# In some original album questions, lyricSong contains a different track entirely;
# exclude the same recording from the new questions regardless.
original_ids={norm(x['lyricSong'].split(' (from ')[0]):x for x in base}
all_hits=[]
for artist,titles in HITS.items():
    for song in titles.split(';'):
        if (artist,song) in OMIT or norm(song) in orig_song_names: continue
        # Keep songs short and single-year safe. No 1980s-only / 2000s titles.
        all_hits.append((artist,song))
assert len(all_hits) == len({norm(song)+'-'+artist for artist,song in all_hits})
# Artist pools make wrong choices similar and harder, rather than random absurd distractors.
female={'Reba McEntire','Shania Twain','Patty Loveless','Lorrie Morgan','Pam Tillis','Terri Clark','Faith Hill','Trisha Yearwood','Mary Chapin Carpenter','Suzy Bogguss','Martina McBride','Wynonna','Jo Dee Messina','Lee Ann Womack','Deana Carter','Sara Evans','Chely Wright','Mindy McCready','LeAnn Rimes'}
groups={'Dixie Chicks','Brooks & Dunn','Diamond Rio','Little Texas','BlackHawk','Shenandoah','Sawyer Brown','Restless Heart','The Mavericks','Ricochet','The Kinleys'}
artists=set(HITS)
random.seed(3091)
items=list(base)
for artist,song in all_hits:
    if artist in female: peers=list(sorted(female-{artist}))
    elif artist in groups: peers=list(sorted(groups-{artist}))
    else: peers=list(sorted(artists-female-groups-{artist}))
    wrong=random.sample(peers,3)
    choices=[artist]+wrong; random.shuffle(choices)
    prompt=random.choice([
      'Who recorded the 90s country hit “{}”?',
      'Which artist had a 1990s country hit with “{}”?',
      'Who sings the 90s country favorite “{}”?',
      'Whose 1990s country single is “{}”?',
      'Which act recorded “{}” during the 1990s?',
    ]).format(song)
    hook=HOOKS.get(song, re.sub(r'\s*\([^()]*\)','',song).strip())
    # Lyric snippets are intentionally short, avoiding full verses or choruses.
    hook=' '.join(hook.split()[:10])
    items.append(dict(id=len(items)+1,category='WHO SINGS IT?',topic='hit-'+norm(song),q=prompt,
                      choices=choices,a=choices.index(artist),lyric=hook,lyricSong=song,lyricArtist=artist))

# Every lyric-detail question is a fresh challenge tied to the song/topic and kept
# out of the same single game as another question about that recording.
for song, artist, stem, correct, wrong, snippet in DETAILS:
    choices=[correct]+wrong
    random.shuffle(choices)
    items.append(dict(id=len(items)+1,category='LYRIC DETECTIVE',
        topic='hit-'+norm(song),q=stem,choices=choices,a=choices.index(correct),
        lyric=snippet,lyricSong=song,lyricArtist=artist))

# Verified, fuller hooks for songs where a mere title sounded like a placeholder.
# Applied after generating IDs so subsequent rebuilds retain the edits.
upgrades=json.loads((DATA_DIR/'lyric_upgrades.json').read_text())
for item in items:
    if item['category']=='WHO SINGS IT?' and item['lyricSong'] in upgrades:
        item['lyric']=upgrades[item['lyricSong']]
    if item['id']==10:
        item['lyric']='the lady in the second row, she’s an eight'
    if item['id']==11:
        item['lyric']='ruby red lips, blond hair, blue eyes'

# Full sung lines for the reveal, replacing the original title-only hooks. Keyed by question id,
# which never changes because new questions are only appended below.
for qid,lyric in json.loads((DATA_DIR/'snippets.json').read_text()).items():
    items[int(qid)-1]['lyric']=lyric
for qid,fix in json.loads((DATA_DIR/'question_fixes.json').read_text()).items():
    items[int(qid)-1].update(fix)

# Songs added after the original bank. Each keeps its own topic so players' played-song
# history (stored by topic) carries over untouched.
existing_topics={q['topic'] for q in items}
FEMALE_MORE={'Kathy Mattea','Tanya Tucker','Carlene Carter','Lari White','Michelle Wright','K.T. Oslin','Lila McCann','Sara Evans','Chely Wright','Mindy McCready'}
GROUPS_MORE={'Alabama','The Judds','The Kentucky Headhunters','Confederate Railroad','Lonestar','Montgomery Gentry','SHeDAISY','Sons of the Desert','Pirates of the Mississippi','McBride & the Ride','Alison Krauss & Union Station','Little Texas','BlackHawk','Ricochet'}
new_songs=json.loads((DATA_DIR/'new_songs.json').read_text())
all_artists=set(HITS)|{x['artist'] for x in new_songs}
female_all=(female|FEMALE_MORE)&all_artists
groups_all=(groups|GROUPS_MORE)&all_artists
duets={a for a in all_artists if any(k in a for k in (' & ',' with ',' and ')) and a not in groups_all}|{'Reba McEntire & Vince Gill','Tim McGraw & Faith Hill','Brooks & Dunn & Reba McEntire'}
male_all=all_artists-female_all-groups_all-duets
LABEL={'who':'WHO SINGS IT?','finish':'FINISH THE LYRIC','name':'NAME THAT SONG','detail':'LYRIC DETECTIVE'}
for x in new_songs:
    topic='hit-'+norm(x['song'])
    assert topic not in existing_topics, x['song']
    existing_topics.add(topic)
    if x['type']=='who':
        artist=x['artist']
        pool=next(p for p in (female_all,groups_all,duets,male_all) if artist in p)
        choices=[artist]+random.sample(sorted(pool-{artist}),3)
        random.shuffle(choices)
        q=random.choice([
          'Who recorded the 90s country hit “{}”?',
          'Which artist had a 1990s country hit with “{}”?',
          'Who sings the 90s country favorite “{}”?',
          'Whose 1990s country single is “{}”?',
        ]).format(x['song'])
        correct=artist
    else:
        choices=[x['correct']]+x['wrong']
        random.shuffle(choices)
        q,correct=x['q'],x['correct']
    items.append(dict(id=len(items)+1,category=LABEL[x['type']],topic=topic,q=q,choices=choices,
        a=choices.index(correct),lyric=x['snippet'],lyricSong=x['song'],lyricArtist=x['artist']))

# Validate answer parity, unique ids, 1 unambiguous key per question, and lyric cap.
assert len({q['id'] for q in items})==len(items)
assert len({q['topic'] for q in items[len(base):len(base)+len(all_hits)]})==len(all_hits)
for q in items:
    assert len(q['choices'])==4 and len(set(q['choices']))==4
    assert 0<=q['a']<4 and q['choices'][q['a']]
    assert q['lyric'] and len(q['lyric'].replace(' / ',' ').split())<=25, q['lyric']
    assert q['lyricSong'] and q['lyricArtist']
(ROOT/'src/country/questions.js').write_text('export const QUESTIONS = '+json.dumps(items,ensure_ascii=False,indent=2)+';\n')
(ROOT/'public/country/questions.js').write_text('window.QBANK = '+json.dumps(items,ensure_ascii=False,indent=2)+';\n')
print(f'{len(base)} original + {len(all_hits)} artist + {len(DETAILS)} lyric + {len(new_songs)} added = {len(items)} trivia questions')
