require('dotenv').config();
const mongoose = require('mongoose');

let MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/care';

// URI 검증 및 수정
console.log('=== MongoDB 연결 테스트 ===\n');

// URI에 데이터베이스 이름이 없으면 추가
if (MONGODB_URI.includes('mongodb+srv://') || MONGODB_URI.includes('mongodb://')) {
  // URI가 /로 끝나면 /care 추가
  if (MONGODB_URI.endsWith('/')) {
    console.log('⚠️  URI에 데이터베이스 이름이 없습니다. /care를 추가합니다.');
    MONGODB_URI = MONGODB_URI + 'care';
  }
  // URI에 ?가 있으면 그 앞에 데이터베이스 이름이 있는지 확인
  if (MONGODB_URI.includes('?') && !MONGODB_URI.match(/\/[^\/\?]+\?/)) {
    console.log('⚠️  URI에 데이터베이스 이름이 없습니다. /care를 추가합니다.');
    MONGODB_URI = MONGODB_URI.replace(/\?/, '/care?');
  }
}

const maskedURI = MONGODB_URI.replace(/:[^:@]+@/, ':****@');
console.log('연결 URI:', maskedURI);
console.log('데이터베이스:', MONGODB_URI.match(/\/([^\/\?]+)(\?|$)/)?.[1] || '없음');
console.log('\n⚠️  연결 실패 시 확인 사항:');
console.log('1. .env 파일에 MONGODB_URI가 올바르게 설정되어 있는지 확인');
console.log('2. 비밀번호에 특수문자가 있으면 URL 인코딩 필요 (예: @ -> %40, # -> %23)');
console.log('3. URI 형식: mongodb+srv://username:password@cluster.mongodb.net/database_name?retryWrites=true&w=majority');
console.log('4. MongoDB Atlas에서 IP 주소가 화이트리스트에 추가되어 있는지 확인 (0.0.0.0/0로 모든 IP 허용 가능)');
console.log('5. 사용자 이름과 비밀번호가 정확한지 확인\n');

// 연결 옵션 추가
const connectionOptions = {
  serverSelectionTimeoutMS: 5000, // 5초 타임아웃
  socketTimeoutMS: 45000,
};

console.log('연결 시도 중...\n');

mongoose.connect(MONGODB_URI, connectionOptions)
  .then(() => {
    console.log('✅ MongoDB가 연결되었습니다!');
    console.log('연결 상태:', mongoose.connection.readyState === 1 ? '연결됨' : '연결 안됨');
    console.log('데이터베이스:', mongoose.connection.name);
    console.log('호스트:', mongoose.connection.host);
    console.log('클러스터:', mongoose.connection.host);
    
    // 연결 테스트 후 종료
    mongoose.connection.close();
    console.log('\n연결을 종료했습니다.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ MongoDB 연결 실패:', error.message);
    
    if (error.message.includes('authentication failed')) {
      console.error('\n🔍 인증 실패 원인 분석:');
      console.error('1. 비밀번호 확인: .env 파일의 MONGODB_URI에서 비밀번호가 정확한지 확인');
      console.error('2. 비밀번호 특수문자: 비밀번호에 @, #, %, &, +, = 등이 있으면 URL 인코딩 필요');
      console.error('   예: @ -> %40, # -> %23, % -> %25, & -> %26, + -> %2B, = -> %3D');
      console.error('3. 사용자 확인: MongoDB Atlas에서 사용자 이름이 "choiyoungmi2252_db_user"인지 확인');
      console.error('4. 권한 확인: 사용자에게 데이터베이스 접근 권한이 있는지 확인');
      console.error('5. IP 화이트리스트: MongoDB Atlas > Network Access에서 현재 IP 또는 0.0.0.0/0 추가');
    }
    
    if (error.message.includes('timeout')) {
      console.error('\n🔍 타임아웃 원인:');
      console.error('1. 네트워크 연결 확인');
      console.error('2. MongoDB Atlas 클러스터가 실행 중인지 확인');
      console.error('3. 방화벽 설정 확인');
    }
    
    console.error('\n상세 오류:', error);
    process.exit(1);
  });
