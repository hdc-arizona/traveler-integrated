# include <stdio.h>
# include <stdlib.h>
# include <math.h>

int binary_srch(long long *arr, int l, int r, long long x) {
	int mid;
	long long midX;
	while(1) {
		if( r >= l) {
			mid = l + ((r-l)>>1);
			midX = arr[mid];

			if(midX == x) return mid;
			else if(x < midX && x > arr[mid-1]) return mid-1;
			else if(midX > x) r = mid - 1;
			else l = mid + 1;
		} else {
			return r;
		}
	}
	return r;
}

void calcHistogram(long long *histogram_counter, int histogram_size,
		long long *histogram_index,
		double *histogram_util, 
		long long *critical_points, int critical_points_size,
		long long *location_index, int location_size,
		long long *location_counter,
		double *location_util) {
	int i;
	int nextRecordIndex = 0;
	double util = 0.0;
	
	for(i=0;i<critical_points_size;i++){
		long long pt = critical_points[i];
		if(pt < location_index[0]) {
			histogram_index[i] = pt;
			histogram_counter[i] = 0;
			histogram_util[i] = 0;
		} else {
			nextRecordIndex = binary_srch(location_index, nextRecordIndex, location_size, pt);
			util = (((pt - location_index[nextRecordIndex]) * location_counter[nextRecordIndex]) + location_util[nextRecordIndex]);
            histogram_index[i] = pt;
			histogram_counter[i] = location_counter[nextRecordIndex];
			histogram_util[i] = util;
		}
	}
}

/*
int main() {
	int v[10], i;
	for(i=0;i<10;i++)v[i] = i+1;
	read_pointer(v, 3);
	return 0;
}
*/
