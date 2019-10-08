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
If you only want to visualize trees, you can just run `serve.py` and upload the
relevant files in the interface.

If you need to bundle traces, or upload a lot of different datasets, you will
need to run `bundle.py` before running `serve.py`. See `bundle.py --help` for
details on how to load different combinations of STDOUT dumps from phylanx runs;
individual trees; performance CSV files; DOT files; and source code files.

If something goes wrong, `bundle.py` ***should*** behave reasonably
idempotently, but if you just want to start with a fresh slate anyway, try
`rm -rf /tmp/traveler-integrated`.

## Bundling Examples
For details on all of the ways to bundle data:
```bash
./bundle.py --help
```

A simple example bundling the full phylanx output and an OTF2 trace:
```bash
./bundle.py \
  --input data/als-30Jan2019/test_run/output.txt \
  --otf2 data/als-30Jan2019/test_run/OTF2_archive/APEX.otf2 \
  --label "2019-01-30 ALS Test Run"
```

Bunding just an OTF2 trace, as well as a source code file:
```bash
./bundle.py \
  --otf2 data/fibonacci-04Apr2018/OTF2_archive/APEX.otf2 \
  --python data/fibonacci-04Apr2018/fibonacci.py \
  --label "2019-04-04 Fibonacci"
```

Loading many files at once (using a regular expression to match globbed paths):
```bash
./bundle.py \
  --tree data/als_regression/*.txt \
  --performance data/als_regression/*.csv \
  --physl data/als_regression/als.physl \
  --cpp data/als_regression/als_csv_instrumented.cpp \
  --label "data/als_regression/(\d*-\d*-\d*).*"
```

Bringing it all together:
```bash
./bundle.py \
  --otf2 data/11July2019/factorial*/OTF2_archive/APEX.otf2 \
  --input data/11July2019/factorial*/output.txt \
  --physl data/factorial.physl \
  --label "data\/(11July2019\/factorial[^/]*).*"
```

## Serving
Running `./serve.py` will launch a web server on port 8000

The web server contains a (work in progress) web interface, as well as ReDoc /
Swagger interfaces to its underlying API.

# Developing
Anything inside the `static` directory will be served; see its [README](https://github.com/alex-r-bigelow/traveler-integrated/master/static/README.md) for info on developing the web interface.

On the server side, one of the big priorities at the moment is that we're using
a [hacked version](https://github.com/alex-r-bigelow/intervaltree) of [intervaltree](https://github.com/chaimleib/intervaltree)
as a poor man's index into the data (that allows for fast histogram computations).
There are probably a few opportunities for scalability:
- These are all built in memory and pickled to a file, meaning that this is the
current bottleneck for loading large trace files. It would be really cool if we
could make a version of this library that spools to disk when it gets too big,
kind of like python's native `shelve` library.
- We really only need to build these things once, and do read-only queries—we
should be able to build the indexes more efficiently if we know we'll never have
to update them, and there's likely some functionality in the original library
that we could get away with cutting
