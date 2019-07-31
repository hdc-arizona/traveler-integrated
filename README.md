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
  --input data/als-30Jan2019/test_run/output.txt \
  --otf2 data/als-30Jan2019/test_run/OTF2_archive/APEX.otf2 \
  --label "2019-01-30 ALS Test Run"
```

Bunding just an OTF2 trace, as well as a source code file (using OTF2 GUIDs to
build the tree—note that, due to the combinatoric nature, this is slow!):
```bash
./bundle.py \
  --otf2 data/fibonacci-04Apr2018/OTF2_archive/APEX.otf2 \
  --python data/fibonacci-04Apr2018/fibonacci.py \
  --label "2019-04-04 Fibonacci" \
  --guids
```

Loading many files at once (using a regular expression to match globbed paths):
```bash
./bundle.py \
  --tree data/als_regression/*.txt \
  --performance data/als_regression/*.csv \
  --physl data/als_regression/als.physl \
  --label "data/als_regression/(\d*-\d*-\d*).*"
```

Bringing it all together:
```bash
./bundle.py \
  --otf2 data/11July2019/factorial*/OTF2_archive/APEX.otf2 \
  --input data/11July2019/factorial*/output.txt \
  --physl data/factorial.physl \
  --label "data\/(11July2019\/factorial[^/]*).*" \
  --guids
```

## Serving
Running `./serve.py` will launch a web server on port 8000

The web server contains a [(work in progress) web interface](https://raw.githubusercontent.com/alex-r-bigelow/traveler-integrated/master/docs/interface.png) for viewing trees and
traces directly, as well as a [REST API (with a Swagger interface)](https://raw.githubusercontent.com/alex-r-bigelow/traveler-integrated/master/docs/api.png)
