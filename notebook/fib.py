from phylanx import Phylanx
from visualizeInTraveler import visualizeInTraveler

@Phylanx(performance="x")
def fib(n):
    if n < 2:
        return n
    else:
        return fib(n-1)+fib(n-2)

fib(10)
visualizeInTraveler(fib)

# TODO: convert this file to a notebook
