import numpy as np
from profilier import Profilier

def mm(A, B):
    if A.shape[1] != B.shape[0]:
        print("error")
        return

    C = np.zeros((A.shape[0], B.shape[1]))
    for i in range(A.shape[0]):
        for j in range(B.shape[1]):
            sum = 0
            for k in range(A.shape[1]):
                sum += A[i][k] * B[k][j]
            C[i][j] = sum


def test():
    prf = Profilier()

    A = np.random.rand(200,200)
    B = np.random.rand(200,200)

    n = 10
    for i in range(n):
        if i % 1 is 0:
            print(".")
        prf.start()
        mm(A, B)
        prf.end()




    prf.dumpAverageStats('cumulative', 'sts_avg_over_{}_calls.prof'.format(n), n)


test()
