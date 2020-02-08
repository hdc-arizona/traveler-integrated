import cProfile, pstats, io

def profile(funct):
    def wrapper(*args, **kwargs):
        pr = cProfile.Profile()
        pr.enable()

        ret = funct(*args, **kwargs)

        pr.disable()
        s = io.StringIO()
        sortby = 'cumulative'
        ps = pstats.Stats(pr, stream=s).sort_stats(sortby)
        ps.print_stats()
        print(s.getvalue())

        return ret

    return wrapper
