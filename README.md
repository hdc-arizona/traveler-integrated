traveler-integrated
===================

An integrated visualization system for connecting OTF2 stack traces and aggregate expression trees

# Setup

## OTF2
This script also requires [otf2](https://www.vi-hps.org/projects/score-p/) to be installed

## Python dependencies
```bash
python3 -m venv env
source env/bin/activate
pip3 install -r requirements.txt
```

# Running
A simple example:
```bash
./serve.py --input stdout.txt --otf2 OTF2_archive/APEX.otf2
```