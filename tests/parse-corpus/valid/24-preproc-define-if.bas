' Spec section 10: #define (object-like and function-like), #undef and the conditional directives.
#define DEBUG
#define MAX_ENEMIES 8
#define GREETING "HELLO"
#define SQUARE(x) ((x) * (x))
#define DIST2(a, b) (SQUARE(a) + SQUARE(b))
#define LOG_VALUE(v) PRINT "v ="; v
#define NOTHING
#undef DEBUG

#ifdef DEBUG
PRINT "debug build"
#else
PRINT "release build"
#endif

#ifndef MAX_ENEMIES
#define MAX_ENEMIES 4
#endif

#if defined(CPC464) AND NOT defined(PLUS)
PRINT "464"
#elif defined PLUS || defined(__VERSION__)
PRINT "plus"
#elif MAX_ENEMIES = 8
PRINT "eight"
#else
PRINT "other"
#endif

#if MAX_ENEMIES > 4 && MAX_ENEMIES <= 16
  #if !defined(DEBUG) && (MAX_ENEMIES % 2 == 0)
PRINT "even and no debug"
  #endif
#endif

#ifdef __CPC__
PRINT GREETING; " from "; __FILE__; " line"; __LINE__
#endif
PRINT __CPCBAS__; __DATE__
d = DIST2(3, 4) + SQUARE(MAX_ENEMIES)
LOG_VALUE(d)
NOTHING
