' Spec sections 9 and 16: CHAIN with a start line and CHAIN MERGE with DELETE are refused. Each line is independent.
10 CHAIN "next", 200
20 CHAIN MERGE "overlay"
30 CHAIN MERGE "overlay", 100, DELETE 10-90
