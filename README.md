traveler-integrated
===================

An integrated visualization system for connecting OTF2 stack traces and aggregate expression trees

# Setup
```bash
python3 -m venv env
source env/bin/activate
pip3 install -r requirements.txt
```

# Using a finished phylanx run
```bash
./serve.py --input stdout.txt --otf2 OTF2_archive/APEX.otf2
```