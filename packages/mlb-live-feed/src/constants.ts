export const MLB_STATS_API_ORIGIN = "https://statsapi.mlb.com";
export const METS_TEAM_ID = 121;
export const MINIMUM_POLL_WAIT_MS = 10_000;
export const MAXIMUM_POLL_WAIT_MS = 60_000;

export const MAXIMUM_RESPONSE_BYTES = 4_000_000;
export const MAXIMUM_ARCHIVE_TIMESTAMPS = 10_000;
export const MLB_REQUEST_TIMEOUT_MS = 15_000;
export const MLB_TIMECODE_PATTERN = /^\d{8}_\d{6}$/;

/**
 * Every key the browser normalizer reads from a live feed, at any depth. MLB
 * applies `fields=` at every level, so this trims a feed from roughly 750 KB
 * to 150 KB without changing the normalized capture. It is a superset of the
 * firmware's list in firmware/lib/mlb_feed/src/feed.cpp, and
 * scripts/check-core-constants.mjs keeps it that way.
 */
export const LIVE_FEED_FIELDS =
  "abbreviation,about,abstractGameState,allPlays,atBatIndex,atBats,away,balls,batter," +
  "batting,boxscore,code,count,currentInning,currentPlay,dateTime,datetime,defense," +
  "description,detailedState,details,endTime,errors,eventType,first,fullName,game,gameData," +
  "gameNumber,gamePk,group,halfInning,hits,home,homeRuns,id,inProgress,inning,inningHalf," +
  "inningState,innings,isComplete,isOverturned,label,linescore,liveData,location,matchup," +
  "metaData,name,num,numberOfPitches,offense,outs,pitcher,pitching,playEvents,playId," +
  "players,plays,rbi,reason,result,review,reviewDetails,runs,second,stats,status," +
  "statusCode,strikes,team,teamName,teams,third,timeStamp,timeZone,type,value,venue,wait";
