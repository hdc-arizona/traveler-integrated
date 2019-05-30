traveler-integrated
===================

An integrated visualization system for connecting OTF2 stack traces and
aggregate expression trees

# Setup

## OTF2
If you plan to bundle otf2 traces, [otf2](https://www.vi-hps.org/projects/score-p/)
needs to be installed and its binaries need to be in your `PATH`

## Python dependencies
```bash
python3 -m venv env
source env/bin/activate
pip3 install -r requirements.txt
```

# Running
Running this comes in two phases; bundling, and serving. The `bundle.py` phase
combines and indexes data from various sources (e.g. the full STDOUT dump from
a phylanx run; individual tree, csv, and/or dot files; source code files;
and/or OTF2 trace files). The `serve.py` phase serves all data that you've
bundled in an integrated visualization system that you can load in the browser.

## Bundling
A simple example bundling the full phylanx output and an OTF2 trace:
```bash
./bundle.py \
  --input data/build-30Jan2019/test_run/output.txt \
  --otf2 data/build-30Jan2019/test_run/OTF2_archive/APEX.otf2 \
  --label "2019-01-30 Test Run"
```

Loading many files at once (using a regular expression to match globbed paths):
```bash
./bundle.py \
  --tree data/als_regression/*.txt \
  --performance data/als_regression/*.csv \
  --code data/als_regression/als.physl \
  --label "data/als_regression/(\d*-\d*-\d*).*"
```

## Serving
Running `./serve.py` will launch a web server on port 8000

The web server contains a [(work in progress) web interface](https://raw.githubusercontent.com/alex-r-bigelow/traveler-integrated/master/docs/interface.png) for viewing trees and
traces directly, as well as a [REST API (with a Swagger interface)](https://raw.githubusercontent.com/alex-r-bigelow/traveler-integrated/master/docs/api.png)
