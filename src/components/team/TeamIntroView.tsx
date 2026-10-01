import { useId } from 'react';

/** What team sharing does (TeamShareSpec §1), in the landing guide's plain tone. Beta: free, no payment. */
export const TEAM_INTRO_POINTS = [
  '관리자가 근무표 사진을 한 번 올리면 팀원 모두의 근무를 읽어요. 틀린 칸은 배포 전에 표에서 고쳐요.',
  '팀원은 초대 링크로 참여 요청을 보내고, 관리자가 승인하면 내 달력에 근무가 나타나요. 사진을 따로 올릴 필요가 없어요.',
  '근무표가 바뀌면 바뀐 날짜를 표시해 줘요. 공유 링크·캘린더 추가·이미지 저장은 지금처럼 써요.',
];

const TeamIntroView = () => {
  const titleId = useId();

  return (
    <section className="block" aria-labelledby={titleId}>
      <h2 id={titleId}>팀 공유는 이렇게 써요</h2>
      <ol className="team-intro">
        {TEAM_INTRO_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ol>
      <p className="tiny mb-0">지금은 베타 기간이라 무료예요. 결제 정보를 받지 않아요.</p>
    </section>
  );
};

export default TeamIntroView;
