' Spec sections 3, 6 and 9: a typed-in number-guessing game in the style of the
' Locomotive manual's sample programs: lower-case keywords, several statements
' per line, nested one-line IFs, INPUT with a prompt, and a high-score DATA line.
10 mode 1:ink 0,1:ink 1,24:border 1:paper 0:pen 1:cls
20 randomize time
30 secret=int(rnd*100)+1:tries=0
40 locate 10,2:print "GUESS THE NUMBER"
50 locate 10,3:print string$(16,"=")
60 input "Your guess";g
70 tries=tries+1
80 if g=secret then 130
90 if g<secret then print "too low" else print "too high"
100 if tries>=7 then print "it was";secret:goto 150
110 goto 60
130 print "right in";tries;"goes!"
140 if tries<best then best=tries
150 restore 190
160 read hs$
170 print "best so far: ";hs$
180 end
190 data "none yet"
