"""Legacy command preserved: regenerates the full question bank."""
from runpy import run_path
from pathlib import Path
run_path(str(Path(__file__).parent / "build_questions.py"), run_name="__main__")
