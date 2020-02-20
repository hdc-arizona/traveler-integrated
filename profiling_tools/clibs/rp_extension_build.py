from cffi import FFI
ffibuilder = FFI()

ffibuilder.cdef("""
    int binary_srch(long long *arr, int l, int r, int x);
    void calcHistogram(int *histogram_counter, int histogram_size,
		long long *histogram_index,
		double *histogram_util,
		long long *critical_points, int critical_points_size,
		long long *location_index, int location_size,
		int *location_counter,
		double *location_util);

       """)

ffibuilder.set_source("_cCalcBin",  # name of the output C extension
    """
    #include "calcBin.h"
    """,
    sources=['calcBin.c'],
    libraries=['m'])

if __name__ == "__main__":
        ffibuilder.compile(verbose=True)

